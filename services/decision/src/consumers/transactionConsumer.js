const config = require('../config');
const logger = require('../config/logger');
const { createConsumer, createProducer, publish } = require('../config/kafka');
const decisionEngineService = require('../services/decisionEngineService');
const decisionRepository = require('../repositories/decisionRepository');
const {
  decisionsTotal,
  decisionDuration,
  kafkaMessagesConsumed,
  errorsTotal,
} = require('../utils/metrics');

let consumer = null;
let producer = null;
let isRunning = false;

// Handles start.
const start = async () => {
  if (isRunning) {
    logger.warn('Transaction consumer already running');
    return;
  }

  logger.info('Starting transaction consumer...');
  producer = await createProducer();
  logger.info('Kafka producer ready');

  consumer = await createConsumer();
  await consumer.subscribe({
    topics: [config.kafka.inputTopic, config.kafka.reviewedTopic, config.kafka.appealResolvedTopic],
    fromBeginning: false,
  });

  logger.info('Subscribed to input topics', {
    scoredTopic: config.kafka.inputTopic,
    reviewedTopic: config.kafka.reviewedTopic,
    appealResolvedTopic: config.kafka.appealResolvedTopic,
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      await handleMessage({ topic, partition, message, heartbeat });
    },
  });

  isRunning = true;
  logger.info('Transaction consumer running', {
    inputTopic: config.kafka.inputTopic,
    reviewedTopic: config.kafka.reviewedTopic,
    outputTopicApproved: config.kafka.outputTopicApproved,
    outputTopicFlagged: config.kafka.outputTopicFlagged,
  });
};

// Handles stop.
const stop = async () => {
  if (!isRunning) return;

  logger.info('Stopping transaction consumer...');
  isRunning = false;

  const errors = [];

  if (consumer) {
    try {
      await consumer.disconnect();
      consumer = null;
      logger.info('Kafka consumer disconnected');
    } catch (err) {
      errors.push(err);
      logger.error('Error disconnecting Kafka consumer', { error: err.message });
    }
  }

  if (producer) {
    try {
      await producer.disconnect();
      producer = null;
      logger.info('Kafka producer disconnected');
    } catch (err) {
      errors.push(err);
      logger.error('Error disconnecting Kafka producer', { error: err.message });
    }
  }

  if (errors.length > 0) {
    throw errors[0];
  }
};

// Handles handle message.
const handleMessage = async ({ topic, partition, message, heartbeat }) => {
  if (topic === config.kafka.reviewedTopic) {
    return handleReviewedMessage({ topic, partition, message });
  }
  if (topic === config.kafka.appealResolvedTopic) {
    return handleAppealResolvedMessage({ topic, partition, message });
  }

  const startTime = Date.now();
  const offset = message.offset;
  let transactionId = null;
  let correlationId = null;

  try {
    const raw = message.value?.toString();
    if (!raw) {
      logger.warn('Received empty Kafka message - skipping', { partition, offset });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      logger.error('Malformed JSON in Kafka message - sending to DLQ', {
        partition,
        offset,
        error: parseErr.message,
        preview: raw.substring(0, 200),
      });
      await sendToDlq({ raw, reason: 'parse_error', error: parseErr.message, partition, offset });
      await commitOffset(topic, partition, offset);
      return;
    }

    transactionId = data.transactionId || data.fraudAnalysis?.transactionId;
    correlationId = data.correlationId || message.headers?.['x-correlation-id']?.toString() || transactionId;

    const fraudAnalysis = data.fraudAnalysis;
    const originalTransaction = data.originalTransaction;

    if (!fraudAnalysis || !transactionId) {
      logger.error('Invalid message structure - missing fraudAnalysis', {
        transactionId,
        correlationId,
        partition,
        offset,
      });
      await sendToDlq({
        data,
        correlationId,
        reason: 'missing_fraud_analysis',
        error: 'fraudAnalysis field is required',
        partition,
        offset,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'dlq' });
      return;
    }
    await heartbeat();

    logger.info('Processing scored transaction', {
      transactionId,
      customerId: fraudAnalysis.customerId,
      riskScore: fraudAnalysis.riskScore,
      correlationId,
      partition,
      offset,
    });
    const decisionResult = decisionEngineService.makeDecision(fraudAnalysis, originalTransaction);

    logger.info('Decision made', {
      transactionId,
      decision: decisionResult.decision,
      riskScore: fraudAnalysis.riskScore,
      overrideApplied: decisionResult.overrideApplied,
    });

    const existingDecision = await decisionRepository.findByTransactionId(transactionId);
    if (existingDecision && existingDecision.decision === decisionResult.decision) {
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      logger.warn('Duplicate scored event detected; skipping decision republish', {
        transactionId,
        decision: decisionResult.decision,
        existingDecisionId: existingDecision.decision_id,
        partition,
        offset,
      });
      return;
    }
    const dbResult = await decisionRepository.saveDecision({
      transactionId,
      customerId: fraudAnalysis.customerId,
      merchantId: fraudAnalysis.merchantId,
      riskScore: fraudAnalysis.riskScore,
      mlScore: fraudAnalysis.mlResults?.score,
      ruleScore: fraudAnalysis.ruleResults?.ruleScore,
      fraudFlagged: fraudAnalysis.flagged,
      confidence: fraudAnalysis.mlResults?.confidence,
      decision: decisionResult.decision,
      decisionReason: decisionResult.decisionReason,
      decisionFactors: decisionResult.decisionFactors,
      overrideApplied: decisionResult.overrideApplied,
      overrideReason: decisionResult.overrideReason,
      overrideType: decisionResult.overrideType,
      correlationId,
      decisionVersion: decisionResult.decisionVersion,
      fraudAnalysis,
      originalTransaction,
      decisionMetadata: {
        processedAt: new Date().toISOString(),
        kafkaPartition: partition,
        kafkaOffset: offset,
      },
    });
    await heartbeat();
    const outputPayload = {
      eventType: decisionResult.decision === 'FLAGGED' ? 'transaction.flagged' : 'transaction.finalised',
      transactionId,
      customerId: fraudAnalysis.customerId,
      merchantId: fraudAnalysis.merchantId,
      decision: decisionResult.decision,
      decisionReason: decisionResult.decisionReason,
      decisionFactors: decisionResult.decisionFactors,
      decisionId: dbResult.decisionId,
      decidedAt: dbResult.decidedAt,
      originalTransaction,
      fraudAnalysis,
      processedAt: new Date().toISOString(),
      correlationId,
    };
    const outputTopic = decisionResult.decision === 'FLAGGED'
      ? config.kafka.outputTopicFlagged
      : config.kafka.outputTopicApproved;

    await publish(
      producer,
      outputTopic,
      fraudAnalysis.customerId,
      outputPayload,
      {
        'x-correlation-id': correlationId,
        'x-decision': decisionResult.decision,
        'x-source-service': config.serviceName,
      }
    );
    await commitOffset(topic, partition, offset);

    const durationMs = Date.now() - startTime;
    decisionsTotal.inc({ decision: decisionResult.decision });
    decisionDuration.observe({ decision: decisionResult.decision }, durationMs);
    kafkaMessagesConsumed.inc({ topic, status: 'success' });

    logger.info('Transaction decision completed', {
      transactionId,
      decision: decisionResult.decision,
      decisionId: dbResult.decisionId,
      durationMs,
      partition,
      offset,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('Unhandled error processing transaction', {
      transactionId,
      correlationId,
      error: error.message,
      stack: error.stack,
      partition,
      offset,
      durationMs,
    });

    errorsTotal.inc({ component: 'transaction_consumer', type: 'unhandled' });

    try {
      await sendToDlq({
        transactionId,
        correlationId,
        reason: 'processing_error',
        error: error.message,
        partition,
        offset,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'dlq' });
    } catch (dlqErr) {
      logger.error('Failed to send message to DLQ - offset NOT committed', {
        transactionId,
        dlqError: dlqErr.message,
        partition,
        offset,
      });
      errorsTotal.inc({ component: 'transaction_consumer', type: 'dlq_failure' });
    }
  }
};

// Handles reviewed message.
const handleReviewedMessage = async ({ topic, partition, message }) => {
  const offset = message.offset;
  let transactionId = null;

  try {
    const raw = message.value?.toString();
    if (!raw) {
      logger.warn('Received empty reviewed message - skipping', { topic, partition, offset });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      logger.error('Malformed JSON in reviewed message - skipping', {
        topic,
        partition,
        offset,
        error: parseErr.message,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    transactionId = data.transactionId;
    const reviewedDecision = data.reviewDecision || data.decision;
    const correlationId = data.correlationId || message.headers?.['x-correlation-id']?.toString() || transactionId;

    if (!transactionId || !reviewedDecision) {
      logger.warn('Reviewed event missing required fields - skipping', {
        topic,
        partition,
        offset,
        transactionId,
        reviewedDecision,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    if (!['APPROVED', 'DECLINED', 'FLAGGED'].includes(reviewedDecision)) {
      logger.warn('Reviewed event has invalid decision - skipping', {
        transactionId,
        reviewedDecision,
        topic,
        partition,
        offset,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    const updated = await decisionRepository.applyManualReviewDecision({
      transactionId,
      decision: reviewedDecision,
      correlationId,
      reviewedBy: data.reviewedBy,
      reviewNotes: data.reviewNotes || data.notes || null,
      reviewedAt: data.reviewedAt,
      rawEvent: data,
    });

    if (!updated) {
      logger.warn('No existing decision found for reviewed event', {
        transactionId,
        reviewedDecision,
        topic,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    await commitOffset(topic, partition, offset);
    kafkaMessagesConsumed.inc({ topic, status: 'success' });

    logger.info('Applied manual review decision to decision record', {
      transactionId,
      previousDecision: updated.previousDecision,
      reviewedDecision,
      decisionId: updated.decisionId,
      topic,
      partition,
      offset,
    });
  } catch (error) {
    logger.error('Unhandled error processing reviewed message', {
      transactionId,
      topic,
      partition,
      offset,
      error: error.message,
      stack: error.stack,
    });
    errorsTotal.inc({ component: 'reviewed_consumer', type: 'unhandled' });
    await commitOffset(topic, partition, offset);
    kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
  }
};

// Handles appeal resolved message.
const handleAppealResolvedMessage = async ({ topic, partition, message }) => {
  const offset = message.offset;
  let transactionId = null;

  try {
    const raw = message.value?.toString();
    if (!raw) {
      logger.warn('Received empty appeal resolved message - skipping', { topic, partition, offset });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      logger.error('Malformed JSON in appeal resolved message - skipping', {
        topic,
        partition,
        offset,
        error: parseErr.message,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    transactionId = data.transactionId;
    const resolution = data.outcome || data.resolution;
    const correlationId = data.correlationId || message.headers?.['x-correlation-id']?.toString() || transactionId;

    if (!transactionId || !resolution) {
      logger.warn('Appeal resolved event missing required fields - skipping', {
        topic,
        partition,
        offset,
        transactionId,
        resolution,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    if (!['UPHOLD', 'REVERSE'].includes(String(resolution).toUpperCase())) {
      logger.warn('Appeal resolved event has invalid resolution - skipping', {
        transactionId,
        resolution,
        topic,
        partition,
        offset,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    const updated = await decisionRepository.applyAppealResolution({
      transactionId,
      resolution: String(resolution).toUpperCase(),
      correlationId,
      reviewedBy: data.reviewedBy,
      resolutionNotes: data.resolutionNotes || data.notes || null,
      resolvedAt: data.resolvedAt,
      rawEvent: data,
    });

    if (!updated) {
      logger.warn('No existing decision found for appeal resolution event', {
        transactionId,
        resolution,
        topic,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    await commitOffset(topic, partition, offset);
    kafkaMessagesConsumed.inc({ topic, status: 'success' });

    logger.info('Applied appeal resolution to decision record', {
      transactionId,
      previousDecision: updated.previousDecision,
      resolution: updated.resolution,
      finalDecision: updated.decision,
      decisionId: updated.decisionId,
      topic,
      partition,
      offset,
    });
  } catch (error) {
    logger.error('Unhandled error processing appeal resolution message', {
      transactionId,
      topic,
      partition,
      offset,
      error: error.message,
      stack: error.stack,
    });
    errorsTotal.inc({ component: 'appeal_resolved_consumer', type: 'unhandled' });
    await commitOffset(topic, partition, offset);
    kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
  }
};

// Handles commit offset.
const commitOffset = async (topic, partition, offset) => {
  if (!consumer) return;
  try {
    await consumer.commitOffsets([
      {
        topic,
        partition,
        offset: (BigInt(offset) + 1n).toString(),
      },
    ]);
  } catch (err) {
    logger.error('Failed to commit Kafka offset', {
      partition,
      offset,
      error: err.message,
    });
    errorsTotal.inc({ component: 'transaction_consumer', type: 'commit_failure' });
    throw err;
  }
};

// Handles send to dlq.
const sendToDlq = async ({ raw, data, transactionId, correlationId, reason, error, partition, offset }) => {
  const dlqPayload = {
    eventType: 'transaction.decision.dlq',
    reason,
    error,
    transactionId: transactionId || 'unknown',
    originalData: data || null,
    rawPayload: raw || null,
    correlationId,
    failedAt: new Date().toISOString(),
    sourcePartition: partition,
    sourceOffset: offset,
    serviceName: config.serviceName,
  };

  await publish(
    producer,
    config.kafka.dlqTopic,
    transactionId || 'unknown',
    dlqPayload,
    {
      'x-dlq-reason': reason,
      'x-correlation-id': correlationId || 'unknown',
    }
  );

  logger.warn('Message sent to DLQ', {
    transactionId,
    correlationId,
    reason,
    partition,
    offset,
  });
};

module.exports = { start, stop };

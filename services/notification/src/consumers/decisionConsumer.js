const config = require('../config');
const logger = require('../config/logger');
const { createConsumer, createProducer, publish } = require('../config/kafka');
const notificationService = require('../services/notificationService');
const {
  notificationsTotal,
  notificationDuration,
  kafkaMessagesConsumed,
  errorsTotal,
} = require('../utils/metrics');

let consumer = null;
let producer = null;
let isRunning = false;

// Handles start.
const start = async () => {
  if (isRunning) {
    logger.warn('Decision consumer already running');
    return;
  }

  logger.info('Starting decision consumer...');

  producer = await createProducer();
  logger.info('Kafka producer ready');

  consumer = await createConsumer();

  await consumer.subscribe({
    topics: [
      config.kafka.inputTopicFinalised,
      config.kafka.inputTopicFlagged,
    ],
    fromBeginning: false,
  });

  logger.info('Subscribed to input topics', {
    topics: [config.kafka.inputTopicFinalised, config.kafka.inputTopicFlagged],
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      await handleMessage({ topic, partition, message, heartbeat });
    },
  });

  isRunning = true;
  logger.info('Decision consumer running');
};

// Handles stop.
const stop = async () => {
  if (!isRunning) return;

  logger.info('Stopping decision consumer...');
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
  const startTime = Date.now();
  const offset = message.offset;
  let transactionId = null;
  let correlationId = null;
  let decision = null;

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

    transactionId = data.transactionId;
    decision = data.decision;
    correlationId = data.correlationId || message.headers?.['x-correlation-id']?.toString() || transactionId;

    if (!transactionId || !decision) {
      logger.error('Invalid message structure - missing required fields', {
        transactionId,
        decision,
        partition,
        offset,
      });
      await sendToDlq({
        data,
        correlationId,
        reason: 'missing_required_fields',
        error: 'transactionId and decision are required',
        partition,
        offset,
      });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'dlq' });
      return;
    }

    await heartbeat();

    logger.info('Processing decision notification', {
      transactionId,
      decision,
      correlationId,
      topic,
      partition,
      offset,
    });

    const notificationResults = await notificationService.processDecision(data);

    await heartbeat();

    await commitOffset(topic, partition, offset);

    const durationMs = Date.now() - startTime;

    notificationsTotal.inc({
      decision,
      status: notificationResults.failed === 0 ? 'success' : 'partial',
    });
    notificationDuration.observe({ decision }, durationMs);
    kafkaMessagesConsumed.inc({ topic, status: 'success' });

    logger.info('Notifications processed', {
      transactionId,
      decision,
      total: notificationResults.total,
      successful: notificationResults.successful,
      failed: notificationResults.failed,
      durationMs,
      partition,
      offset,
    });

    if (notificationResults.failed > 0) {
      logger.warn('Some notifications failed after retries', {
        transactionId,
        failed: notificationResults.failed,
      });
    }

  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('Unhandled error processing decision', {
      transactionId,
      decision,
      correlationId,
      error: error.message,
      stack: error.stack,
      partition,
      offset,
      durationMs,
    });

    errorsTotal.inc({ component: 'decision_consumer', type: 'unhandled' });

    try {
      await sendToDlq({
        transactionId,
        decision,
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
      errorsTotal.inc({ component: 'decision_consumer', type: 'dlq_failure' });
    }
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
      topic,
      partition,
      offset,
      error: err.message,
    });
    errorsTotal.inc({ component: 'decision_consumer', type: 'commit_failure' });
    throw err;
  }
};

// Handles send to dlq.
const sendToDlq = async ({ raw, data, transactionId, decision, correlationId, reason, error, partition, offset }) => {
  const dlqPayload = {
    eventType: 'notification.dlq',
    reason,
    error,
    transactionId: transactionId || 'unknown',
    decision: decision || 'unknown',
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
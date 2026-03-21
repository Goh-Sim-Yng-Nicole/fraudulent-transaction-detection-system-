const config = require('../config');
const logger = require('../config/logger');
const { createConsumer } = require('../config/kafka');
const auditRepository = require('../repositories/auditRepository');
const {
  auditEventsTotal,
  auditDuration,
  kafkaMessagesConsumed,
  errorsTotal,
} = require('../utils/metrics');

let consumer = null;
let isRunning = false;

// Handles start.
const start = async () => {
  if (isRunning) {
    logger.warn('Audit consumer already running');
    return;
  }

  logger.info('Starting audit consumer...');

  consumer = await createConsumer();
  await consumer.subscribe({
    topics: config.kafka.topics,
    fromBeginning: false,
  });

  logger.info('Subscribed to topics', { topics: config.kafka.topics });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      await handleMessage({ topic, partition, message, heartbeat });
    },
  });

  isRunning = true;
  logger.info('Audit consumer running');
};

// Handles stop.
const stop = async () => {
  if (!isRunning) return;

  logger.info('Stopping audit consumer...');
  isRunning = false;

  if (consumer) {
    try {
      await consumer.disconnect();
      consumer = null;
      logger.info('Kafka consumer disconnected');
    } catch (err) {
      logger.error('Error disconnecting Kafka consumer', { error: err.message });
      throw err;
    }
  }
};

// Handles handle message.
const handleMessage = async ({ topic, partition, message, heartbeat }) => {
  const startTime = Date.now();
  const offset = message.offset;
  let transactionId = null;
  let eventType = null;

  try {
    const raw = message.value?.toString();
    if (!raw) {
      logger.warn('Received empty Kafka message — skipping', { partition, offset });
      await commitOffset(topic, partition, offset);
      kafkaMessagesConsumed.inc({ topic, status: 'skipped' });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (parseErr) {
      logger.error('Malformed JSON in Kafka message', {
        topic,
        partition,
        offset,
        error: parseErr.message,
        preview: raw.substring(0, 200),
      });
      payload = { _raw: raw, _parseError: parseErr.message };
    }
    eventType = payload.eventType || `kafka.${topic}`;
    transactionId = payload.transactionId || payload.fraudAnalysis?.transactionId || null;
    const customerId = payload.customerId || payload.fraudAnalysis?.customerId || null;
    const correlationId = payload.correlationId || message.headers?.['x-correlation-id']?.toString() || null;
    await heartbeat();

    logger.debug('Processing audit event', {
      topic,
      partition,
      offset,
      eventType,
      transactionId,
    });
    const auditData = {
      eventType,
      eventSource: message.headers?.['service-source']?.toString() || 'unknown',
      eventTimestamp: new Date(parseInt(message.timestamp)),
      transactionId,
      customerId,
      correlationId,
      kafkaTopic: topic,
      kafkaPartition: partition,
      kafkaOffset: offset,
      kafkaTimestamp: new Date(parseInt(message.timestamp)),
      payload,
    };

    const result = await auditRepository.storeEvent(auditData);
    await heartbeat();
    await commitOffset(topic, partition, offset);

    const durationMs = Date.now() - startTime;

    if (result) {
      auditEventsTotal.inc({ event_type: eventType, topic });
      auditDuration.observe({ topic }, durationMs);
      kafkaMessagesConsumed.inc({ topic, status: 'success' });

      logger.info('Audit event recorded', {
        eventId: result.eventId,
        eventType,
        transactionId,
        topic,
        durationMs,
        partition,
        offset,
      });
    } else {
      kafkaMessagesConsumed.inc({ topic, status: 'duplicate' });
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('Unhandled error processing audit event', {
      topic,
      partition,
      offset,
      eventType,
      transactionId,
      error: error.message,
      stack: error.stack,
      durationMs,
    });

    errorsTotal.inc({ component: 'audit_consumer', type: 'unhandled' });
    kafkaMessagesConsumed.inc({ topic, status: 'error' });
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
    errorsTotal.inc({ component: 'audit_consumer', type: 'commit_failure' });
    throw err;
  }
};

module.exports = { start, stop };
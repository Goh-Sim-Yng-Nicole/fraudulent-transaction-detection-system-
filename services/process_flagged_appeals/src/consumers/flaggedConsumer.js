const config = require('../config');
const logger = require('../config/logger');
const { createConsumer, createProducer, publish } = require('../config/kafka');
const reviewService = require('../services/reviewService');

let consumer = null;
let producer = null;
let isRunning = false;
let ownsProducer = false;

const validateFlaggedEvent = (data) => {
  if (!data?.transactionId) {
    return 'transactionId is required';
  }
  if (!data?.customerId && !data?.originalTransaction?.customerId) {
    return 'customerId is required';
  }
  return null;
};

const sendToDlq = async ({ topic, partition, offset, reason, raw = null, data = null, error = null }) => {
  if (!producer) {
    throw new Error('Fraud review DLQ producer is not ready');
  }

  await publish(
    producer,
    config.kafka.dlqTopic,
    data?.transactionId || topic,
    {
      eventType: 'transaction.review.dlq',
      sourceTopic: topic,
      sourcePartition: partition,
      sourceOffset: offset,
      reason,
      error,
      rawPayload: raw,
      originalPayload: data,
      failedAt: new Date().toISOString(),
      serviceName: config.serviceName,
    },
    {
      'x-dlq-reason': reason,
    }
  );
};

// Handles start.
const start = async (sharedProducer = null) => {
  if (isRunning) return;

  producer = sharedProducer || await createProducer();
  ownsProducer = !sharedProducer;
  consumer = await createConsumer();
  await consumer.subscribe({
    topic: config.kafka.inputTopicFlagged,
    fromBeginning: false,
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const offset = message.offset;
      const raw = message.value?.toString();

      if (!raw) {
        logger.warn('Sending empty flagged event to DLQ', { topic, partition, offset });
        await sendToDlq({ topic, partition, offset, reason: 'empty_payload' });
        await commitOffset(topic, partition, offset);
        return;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        logger.error('Sending malformed flagged event to DLQ', {
          topic,
          partition,
          offset,
          error: err.message,
        });
        await sendToDlq({
          topic,
          partition,
          offset,
          reason: 'parse_error',
          raw,
          error: err.message,
        });
        await commitOffset(topic, partition, offset);
        return;
      }

      const validationError = validateFlaggedEvent(data);
      if (validationError) {
        logger.error('Sending invalid flagged event to DLQ', {
          topic,
          partition,
          offset,
          error: validationError,
        });
        await sendToDlq({
          topic,
          partition,
          offset,
          reason: 'invalid_event',
          raw,
          data,
          error: validationError,
        });
        await commitOffset(topic, partition, offset);
        return;
      }

      try {
        await heartbeat();
        await reviewService.enqueueFlagged(data, topic);
        await commitOffset(topic, partition, offset);

        logger.info('Flagged transaction queued for manual review', {
          transactionId: data.transactionId,
          topic,
          partition,
          offset,
        });
      } catch (err) {
        logger.error('Failed to process flagged event', {
          topic,
          partition,
          offset,
          transactionId: data.transactionId,
          error: err.message,
        });
        throw err;
      }
    },
  });

  isRunning = true;
  logger.info('Flagged consumer started', { topic: config.kafka.inputTopicFlagged });
};

// Handles stop.
const stop = async () => {
  if (!consumer) return;
  await consumer.disconnect();
  consumer = null;
  if (producer && ownsProducer) {
    await producer.disconnect();
  }
  producer = null;
  ownsProducer = false;
  isRunning = false;
};

// Handles commit offset.
const commitOffset = async (topic, partition, offset) => {
  if (!consumer) return;
  await consumer.commitOffsets([{
    topic,
    partition,
    offset: (BigInt(offset) + 1n).toString(),
  }]);
};

module.exports = { start, stop };

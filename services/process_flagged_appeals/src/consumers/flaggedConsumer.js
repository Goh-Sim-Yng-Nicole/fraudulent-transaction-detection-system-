const config = require('../config');
const logger = require('../config/logger');
const { createConsumer } = require('../config/kafka');
const reviewService = require('../services/reviewService');

let consumer = null;
let isRunning = false;

// Handles start.
const start = async () => {
  if (isRunning) return;

  consumer = await createConsumer();
  await consumer.subscribe({
    topic: config.kafka.inputTopicFlagged,
    fromBeginning: false,
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const offset = message.offset;
      try {
        const raw = message.value?.toString();
        if (!raw) {
          await commitOffset(topic, partition, offset);
          return;
        }

        const data = JSON.parse(raw);
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
          error: err.message,
        });
        await commitOffset(topic, partition, offset);
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

const config = require('../config');
const logger = require('../config/logger');
const { createConsumer } = require('../config/kafka');
const projectionStore = require('./projectionStore');

class EventConsumerService {
  constructor() {
    this.consumer = null;
    this.isRunning = false;
    this.startedAt = null;
    this.lastProcessedAt = null;
    this.lastProcessedTopic = null;
    this.lastProcessedOffset = null;
    this.lastError = null;
  }

  async start() {
    if (!config.kafka.enableConsumer) {
      logger.info('Analytics Kafka consumer disabled by configuration');
      return;
    }

    if (this.isRunning) {
      logger.warn('Analytics Kafka consumer already running');
      return;
    }

    this.consumer = await createConsumer();
    await this.consumer.subscribe({
      topics: config.kafka.topics,
      fromBeginning: true,
    });

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        await this._handleMessage(topic, partition, message);
      },
    });

    this.isRunning = true;
    this.startedAt = new Date().toISOString();
    this.lastError = null;

    logger.info('Analytics Kafka consumer started', {
      groupId: config.kafka.groupId,
      topics: config.kafka.topics,
    });
  }

  async stop() {
    if (!this.consumer) {
      this.isRunning = false;
      return;
    }

    await this.consumer.disconnect();
    this.consumer = null;
    this.isRunning = false;
    logger.info('Analytics Kafka consumer stopped');
  }

  getStatus() {
    return {
      enabled: config.kafka.enableConsumer,
      running: this.isRunning,
      groupId: config.kafka.groupId,
      topics: config.kafka.topics,
      startedAt: this.startedAt,
      lastProcessedAt: this.lastProcessedAt,
      lastProcessedTopic: this.lastProcessedTopic,
      lastProcessedOffset: this.lastProcessedOffset,
      lastError: this.lastError,
    };
  }

  async _handleMessage(topic, partition, message) {
    const offset = message.offset;
    const raw = message.value?.toString();

    if (!raw) {
      logger.warn('Skipping empty analytics event', { topic, partition, offset });
      await this._commitOffset(topic, partition, offset);
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      this.lastError = err.message;
      logger.error('Skipping malformed analytics event', {
        topic,
        partition,
        offset,
        error: err.message,
      });
      await this._commitOffset(topic, partition, offset);
      return;
    }

    try {
      await this._applyProjection(topic, payload);
      this.lastProcessedAt = new Date().toISOString();
      this.lastProcessedTopic = topic;
      this.lastProcessedOffset = offset;
      this.lastError = null;
      await this._commitOffset(topic, partition, offset);
    } catch (err) {
      this.lastError = err.message;
      logger.error('Analytics projection update failed', {
        topic,
        partition,
        offset,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  async _applyProjection(topic, payload) {
    switch (topic) {
      case 'transaction.finalised':
      case 'transaction.flagged':
        await projectionStore.upsertDecisionEvent(payload);
        break;
      case 'transaction.reviewed':
        await projectionStore.applyManualReview(payload);
        break;
      case 'appeal.created':
        await projectionStore.upsertAppealCreated(payload);
        break;
      case 'appeal.resolved':
        await projectionStore.upsertAppealResolved(payload);
        break;
      default:
        logger.warn('Received unhandled analytics topic', { topic });
    }
  }

  async _commitOffset(topic, partition, offset) {
    if (!this.consumer) {
      return;
    }

    await this.consumer.commitOffsets([
      {
        topic,
        partition,
        offset: (BigInt(offset) + 1n).toString(),
      },
    ]);
  }
}

module.exports = new EventConsumerService();

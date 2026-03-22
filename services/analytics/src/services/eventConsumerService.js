const config = require('../config');
const logger = require('../config/logger');
const { createConsumer, createProducer, publish } = require('../config/kafka');
const projectionStore = require('./projectionStore');

class EventConsumerService {
  constructor() {
    this.consumer = null;
    this.producer = null;
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

    this.producer = await createProducer();
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
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }

    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }

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
      logger.warn('Sending empty analytics event to DLQ', { topic, partition, offset });
      await this._sendToDlq({
        topic,
        partition,
        offset,
        reason: 'empty_payload',
      });
      await this._commitOffset(topic, partition, offset);
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      this.lastError = err.message;
      logger.error('Sending malformed analytics event to DLQ', {
        topic,
        partition,
        offset,
        error: err.message,
      });
      await this._sendToDlq({
        topic,
        partition,
        offset,
        reason: 'parse_error',
        raw,
        error: err.message,
      });
      await this._commitOffset(topic, partition, offset);
      return;
    }

    const validationError = this._validatePayload(topic, payload);
    if (validationError) {
      this.lastError = validationError;
      logger.error('Sending invalid analytics event to DLQ', {
        topic,
        partition,
        offset,
        error: validationError,
      });
      await this._sendToDlq({
        topic,
        partition,
        offset,
        reason: 'invalid_event',
        raw,
        payload,
        error: validationError,
      });
      await this._commitOffset(topic, partition, offset);
      return;
    }

    try {
      const handled = await this._applyProjection(topic, payload);
      if (!handled) {
        this.lastError = `No analytics projection handler for topic ${topic}`;
        logger.error('Sending unhandled analytics event to DLQ', {
          topic,
          partition,
          offset,
        });
        await this._sendToDlq({
          topic,
          partition,
          offset,
          reason: 'unhandled_topic',
          raw,
          payload,
          error: `No analytics projection handler for topic ${topic}`,
        });
        await this._commitOffset(topic, partition, offset);
        return;
      }

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

  _validatePayload(topic, payload) {
    switch (topic) {
      case 'transaction.finalised':
      case 'transaction.flagged':
        return payload?.transactionId ? null : 'transactionId is required for transaction decision projections';
      case 'transaction.reviewed':
        if (!payload?.transactionId) {
          return 'transactionId is required for manual review projections';
        }
        if (!payload?.reviewDecision && !payload?.decision) {
          return 'reviewDecision is required for manual review projections';
        }
        return null;
      case 'appeal.created':
      case 'appeal.resolved':
        return payload?.appealId ? null : 'appealId is required for appeal projections';
      default:
        return null;
    }
  }

  async _applyProjection(topic, payload) {
    switch (topic) {
      case 'transaction.finalised':
      case 'transaction.flagged':
        await projectionStore.upsertDecisionEvent(payload);
        return true;
      case 'transaction.reviewed':
        await projectionStore.applyManualReview(payload);
        return true;
      case 'appeal.created':
        await projectionStore.upsertAppealCreated(payload);
        return true;
      case 'appeal.resolved':
        await projectionStore.upsertAppealResolved(payload);
        return true;
      default:
        return false;
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

  async _sendToDlq({ topic, partition, offset, reason, raw = null, payload = null, error = null }) {
    if (!this.producer) {
      throw new Error('Analytics DLQ producer is not ready');
    }

    const partitionKey = payload?.transactionId || payload?.appealId || topic;
    await publish(
      this.producer,
      config.kafka.dlqTopic,
      partitionKey,
      {
        eventType: 'analytics.dlq',
        sourceTopic: topic,
        sourcePartition: partition,
        sourceOffset: offset,
        reason,
        error,
        rawPayload: raw,
        originalPayload: payload,
        failedAt: new Date().toISOString(),
        serviceName: config.serviceName,
      },
      {
        'x-dlq-reason': reason,
      }
    );
  }
}

module.exports = new EventConsumerService();

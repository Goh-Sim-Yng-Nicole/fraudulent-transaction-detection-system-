const { Kafka } = require('kafkajs');
const config = require('../config');
const logger = require('../config/logger');
const transactionRepository = require('../repositories/transactionRepository');
const { createProducer, publish } = require('./producer');

let consumer = null;

const normalizeEvent = (topic, payload) => {
  const data = payload?.data || {};
  const transactionId = payload?.transactionId || payload?.transaction_id || data.transaction_id || data.transactionId;

  if (!transactionId) {
    return null;
  }

  if (topic === config.kafka.topics.transactionFlagged) {
    return {
      transactionId,
      status: 'FLAGGED',
      fraudScore: Number(payload?.fraudAnalysis?.riskScore ?? payload?.rules_score ?? data.rules_score ?? null),
      outcomeReason: payload?.decisionReason || payload?.reason || data.reason || 'Transaction flagged for manual review',
    };
  }

  if (topic === config.kafka.topics.transactionFinalised) {
    const outcome = String(payload?.decision || payload?.outcome || data.outcome || '').toUpperCase();
    if (!outcome) {
      return null;
    }
    return {
      transactionId,
      status: outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      fraudScore: Number(payload?.fraudAnalysis?.riskScore ?? payload?.rules_score ?? data.rules_score ?? null),
      outcomeReason: payload?.decisionReason || payload?.reason || data.reason || null,
    };
  }

  if (topic === config.kafka.topics.transactionReviewed) {
    const reviewDecision = String(
      payload?.reviewDecision || payload?.decision || payload?.manual_outcome || data.manual_outcome || ''
    ).toUpperCase();
    if (!reviewDecision) {
      return null;
    }
    return {
      transactionId,
      status: reviewDecision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      fraudScore: Number(payload?.fraudAnalysis?.riskScore ?? payload?.rules_score ?? data.rules_score ?? null),
      outcomeReason: payload?.reviewNotes || payload?.reason || data.reason || 'Manually reviewed',
    };
  }

  if (topic === config.kafka.topics.appealResolved) {
    const resolution = String(payload?.resolution || payload?.outcome || data.manual_outcome || '').toUpperCase();
    if (!resolution) {
      return null;
    }
    return {
      transactionId,
      status: resolution === 'REVERSE' || resolution === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      fraudScore: Number(payload?.fraudAnalysis?.riskScore ?? payload?.rules_score ?? data.rules_score ?? null),
      outcomeReason: payload?.resolutionNotes || payload?.outcome_reason || data.outcome_reason || 'Appeal resolved',
    };
  }

  return null;
};

const commitOffset = async (topic, partition, offset) => {
  if (!consumer) return;
  await consumer.commitOffsets([
    {
      topic,
      partition,
      offset: (BigInt(offset) + 1n).toString(),
    },
  ]);
};

const sendToDlq = async ({ topic, partition, offset, reason, raw = null, payload = null, error = null }) => {
  await publish(
    config.kafka.dlqTopic,
    payload?.transactionId || payload?.data?.transaction_id || topic,
    {
      eventType: 'transaction.dlq',
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
};

const start = async () => {
  if (consumer) return;

  const kafka = new Kafka({
    clientId: `${config.kafka.clientId}-status-consumer`,
    brokers: config.kafka.brokers,
    retry: config.kafka.retry,
  });

  consumer = kafka.consumer({
    groupId: config.kafka.groupId,
    allowAutoTopicCreation: false,
    retry: config.kafka.retry,
  });

  await createProducer();
  await consumer.connect();
  await consumer.subscribe({
    topics: [
      config.kafka.topics.transactionFlagged,
      config.kafka.topics.transactionFinalised,
      config.kafka.topics.transactionReviewed,
      config.kafka.topics.appealResolved,
    ],
    fromBeginning: false,
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const offset = message.offset;
      const raw = message.value?.toString();

      if (!raw) {
        logger.warn('Sending empty transaction status event to DLQ', { topic, partition, offset });
        await sendToDlq({
          topic,
          partition,
          offset,
          reason: 'empty_payload',
        });
        await commitOffset(topic, partition, offset);
        return;
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        logger.error('Sending malformed transaction status event to DLQ', {
          topic,
          partition,
          offset,
          error: error.message,
        });
        await sendToDlq({
          topic,
          partition,
          offset,
          reason: 'parse_error',
          raw,
          error: error.message,
        });
        await commitOffset(topic, partition, offset);
        return;
      }

      try {
        const update = normalizeEvent(topic, payload);
        if (!update) {
          logger.error('Sending invalid transaction status event to DLQ', {
            topic,
            partition,
            offset,
          });
          await sendToDlq({
            topic,
            partition,
            offset,
            reason: 'invalid_event',
            raw,
            payload,
            error: 'Unable to derive a transaction status update from the event',
          });
          await commitOffset(topic, partition, offset);
          return;
        }

        const updated = await transactionRepository.applyStatusUpdate(update);
        if (!updated) {
          logger.error('Sending transaction status event for unknown transaction to DLQ', {
            topic,
            partition,
            offset,
            transactionId: update.transactionId,
          });
          await sendToDlq({
            topic,
            partition,
            offset,
            reason: 'unknown_transaction',
            raw,
            payload,
            error: `Transaction ${update.transactionId} was not found`,
          });
          await commitOffset(topic, partition, offset);
          return;
        }

        await commitOffset(topic, partition, offset);
      } catch (error) {
        logger.error('Failed to apply transaction status update', {
          topic,
          partition,
          offset,
          error: error.message,
        });
        throw error;
      }
    },
  });

  logger.info('Transaction status consumer started');
};

const stop = async () => {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
};

module.exports = {
  start,
  stop,
};

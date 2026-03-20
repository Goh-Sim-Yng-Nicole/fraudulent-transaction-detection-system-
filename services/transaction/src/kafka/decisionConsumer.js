const { Kafka } = require('kafkajs');
const config = require('../config');
const logger = require('../config/logger');
const transactionRepository = require('../repositories/transactionRepository');

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
      outcomeReason: payload?.decisionReason || payload?.reason || data.reason || 'Transaction flagged for manual review'
    };
  }

  if (topic === config.kafka.topics.transactionFinalised) {
    const outcome = String(payload?.decision || payload?.outcome || data.outcome || '').toUpperCase();
    return {
      transactionId,
      status: outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      fraudScore: Number(payload?.fraudAnalysis?.riskScore ?? payload?.rules_score ?? data.rules_score ?? null),
      outcomeReason: payload?.decisionReason || payload?.reason || data.reason || null
    };
  }

  if (topic === config.kafka.topics.transactionReviewed) {
    const reviewDecision = String(
      payload?.reviewDecision || payload?.decision || payload?.manual_outcome || data.manual_outcome || ''
    ).toUpperCase();
    return {
      transactionId,
      status: reviewDecision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      fraudScore: Number(payload?.fraudAnalysis?.riskScore ?? payload?.rules_score ?? data.rules_score ?? null),
      outcomeReason: payload?.reviewNotes || payload?.reason || data.reason || 'Manually reviewed'
    };
  }

  if (topic === config.kafka.topics.appealResolved) {
    const resolution = String(payload?.resolution || payload?.outcome || data.manual_outcome || '').toUpperCase();
    return {
      transactionId,
      status: resolution === 'REVERSE' || resolution === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      fraudScore: Number(payload?.fraudAnalysis?.riskScore ?? payload?.rules_score ?? data.rules_score ?? null),
      outcomeReason: payload?.resolutionNotes || payload?.outcome_reason || data.outcome_reason || 'Appeal resolved'
    };
  }

  return null;
};

const start = async () => {
  if (consumer) return;

  const kafka = new Kafka({
    clientId: `${config.kafka.clientId}-status-consumer`,
    brokers: config.kafka.brokers
  });

  consumer = kafka.consumer({
    groupId: config.kafka.groupId,
    allowAutoTopicCreation: true
  });

  await consumer.connect();
  await consumer.subscribe({
    topics: [
      config.kafka.topics.transactionFlagged,
      config.kafka.topics.transactionFinalised,
      config.kafka.topics.transactionReviewed,
      config.kafka.topics.appealResolved
    ],
    fromBeginning: false
  });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value?.toString();
      if (!raw) return;

      try {
        const payload = JSON.parse(raw);
        const update = normalizeEvent(topic, payload);
        if (!update) {
          return;
        }

        await transactionRepository.applyStatusUpdate(update);
      } catch (error) {
        logger.error('Failed to apply transaction status update', {
          topic,
          partition,
          offset: message.offset,
          error: error.message
        });
      }
    }
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
  stop
};

const { Kafka, CompressionTypes } = require('kafkajs');
const config = require('../config');
const logger = require('../config/logger');
const fraudDetectionService = require('../services/fraudDetectionService');
const decisionPublisher = require('../services/decisionPublisher');

let consumer = null;
let producer = null;

const normalizeTransaction = (payload) => {
  const raw = payload?.transaction || payload?.originalTransaction || payload?.data || payload;
  const metadata = raw?.metadata || {};
  const createdAt = raw?.createdAt || payload?.createdAt || new Date().toISOString();

  return {
    id: raw?.id || raw?.transactionId || raw?.transaction_id,
    customerId: raw?.customerId || raw?.customer_id || payload?.customerId || payload?.customer_id,
    merchantId: raw?.merchantId || raw?.merchant_id || payload?.merchantId || payload?.merchant_id || 'FTDS_TRANSFER',
    amount: Number(raw?.amount),
    currency: raw?.currency || 'SGD',
    cardType: raw?.cardType || raw?.card_type || 'CREDIT',
    createdAt,
    location: raw?.location || { country: raw?.country || 'SG' },
    metadata,
  };
};

const validateTransaction = (transaction) => {
  if (!transaction.id) {
    return 'transaction.id is required';
  }
  if (!transaction.customerId) {
    return 'transaction.customerId is required';
  }
  if (!Number.isFinite(transaction.amount)) {
    return 'transaction.amount must be a finite number';
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
  if (!producer) {
    throw new Error('Detect fraud DLQ producer is not ready');
  }

  await producer.send({
    topic: config.kafka.dlqTopic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: String(payload?.transactionId || payload?.transaction?.id || topic),
        value: JSON.stringify({
          eventType: 'detect-fraud.dlq',
          sourceTopic: topic,
          sourcePartition: partition,
          sourceOffset: offset,
          reason,
          error,
          rawPayload: raw,
          originalPayload: payload,
          failedAt: new Date().toISOString(),
          serviceName: config.serviceName,
        }),
        headers: {
          'content-type': 'application/json',
          'service-source': config.serviceName,
          'x-dlq-reason': reason,
        },
      },
    ],
  });
};

const start = async () => {
  if (consumer) return;

  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    retry: config.kafka.retry,
  });

  consumer = kafka.consumer({
    groupId: config.kafka.groupId,
    allowAutoTopicCreation: false,
    retry: config.kafka.retry,
  });

  producer = kafka.producer({
    allowAutoTopicCreation: false,
    idempotent: true,
    maxInFlightRequests: 1,
    retry: config.kafka.retry,
  });

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: config.kafka.inputTopic, fromBeginning: false });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const offset = message.offset;
      const raw = message.value?.toString();

      if (!raw) {
        logger.warn('Sending empty transaction.created event to DLQ', { topic, partition, offset });
        await sendToDlq({ topic, partition, offset, reason: 'empty_payload' });
        await commitOffset(topic, partition, offset);
        return;
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        logger.error('Sending malformed transaction.created event to DLQ', {
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
        const transaction = normalizeTransaction(payload);
        const validationError = validateTransaction(transaction);
        if (validationError) {
          logger.error('Sending invalid transaction.created event to DLQ', {
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
            payload,
            error: validationError,
          });
          await commitOffset(topic, partition, offset);
          return;
        }

        await heartbeat();
        const fraudAnalysis = await fraudDetectionService.analyzeTransaction(transaction);
        await heartbeat();

        await producer.send({
          topic: config.kafka.outputTopic,
          compression: CompressionTypes.GZIP,
          messages: [
            {
              key: String(transaction.customerId),
              value: JSON.stringify({
                eventType: 'transaction.scored',
                transactionId: transaction.id,
                customerId: transaction.customerId,
                merchantId: transaction.merchantId,
                correlationId: payload.correlationId || payload.trace_id || transaction.id,
                originalTransaction: transaction,
                fraudAnalysis,
                data: {
                  transaction_id: transaction.id,
                  rules_score: fraudAnalysis.riskScore,
                  reason: fraudAnalysis.reasons[0] || null,
                },
                processedAt: new Date().toISOString(),
              }),
              headers: {
                'content-type': 'application/json',
                'service-source': config.serviceName,
              },
            },
          ],
        });

        await heartbeat();
        await decisionPublisher.process({
          producer,
          transaction,
          fraudAnalysis,
          correlationId: payload.correlationId || payload.trace_id || transaction.id,
        });

        await commitOffset(topic, partition, offset);
      } catch (error) {
        logger.error('Fraud detection consumer failed to process transaction', {
          topic,
          partition,
          offset,
          error: error.message,
        });
        throw error;
      }
    },
  });
};

const stop = async () => {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
};

module.exports = {
  start,
  stop,
};

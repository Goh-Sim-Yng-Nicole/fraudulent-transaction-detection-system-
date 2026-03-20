const { Kafka, CompressionTypes } = require('kafkajs');
const config = require('../config');
const logger = require('../config/logger');
const fraudDetectionService = require('../services/fraudDetectionService');

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
    metadata
  };
};

const start = async () => {
  if (consumer) return;

  const kafka = new Kafka({
    clientId: `${config.serviceName}-consumer`,
    brokers: config.kafka.brokers
  });

  consumer = kafka.consumer({
    groupId: `${config.serviceName}-group`,
    allowAutoTopicCreation: true
  });

  producer = kafka.producer({ allowAutoTopicCreation: true });

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: config.kafka.inputTopic, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const raw = message.value?.toString();
      if (!raw) return;

      try {
        const payload = JSON.parse(raw);
        const transaction = normalizeTransaction(payload);
        if (!transaction.id || !transaction.customerId || !Number.isFinite(transaction.amount)) {
          return;
        }

        const fraudAnalysis = await fraudDetectionService.analyzeTransaction(transaction);
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
                  reason: fraudAnalysis.reasons[0] || null
                },
                processedAt: new Date().toISOString()
              }),
              headers: {
                'content-type': 'application/json',
                'service-source': config.serviceName
              }
            }
          ]
        });
      } catch (error) {
        logger.error('Fraud detection consumer failed to process transaction', {
          topic,
          offset: message.offset,
          error: error.message
        });
      }
    }
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
  stop
};

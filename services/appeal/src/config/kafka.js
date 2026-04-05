const { Kafka, Partitioners, CompressionTypes } = require('kafkajs');
const config = require('./index');
const logger = require('./logger');

let kafka = null;

const getKafka = () => {
  if (kafka) return kafka;
  kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    connectionTimeout: 10000,
    requestTimeout: 30000,
    retry: config.kafka.retry,
  });
  return kafka;
};

const createProducer = async () => {
  const producer = getKafka().producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    allowAutoTopicCreation: false,
    idempotent: true,
    maxInFlightRequests: 1,
  });
  await producer.connect();
  logger.info('Kafka producer connected');
  return producer;
};

const publish = async (producer, topic, partitionKey, payload, headers = {}) => {
  const result = await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: partitionKey ? String(partitionKey) : null,
        value: JSON.stringify(payload),
        headers: {
          'content-type': 'application/json',
          'service-source': config.serviceName,
          'service-version': config.serviceVersion,
          'published-at': new Date().toISOString(),
          ...headers,
        },
      },
    ],
  });

  logger.info('Kafka message published', {
    topic,
    partition: result[0]?.partition,
    offset: result[0]?.baseOffset,
  });
};

const createConsumer = async (groupId) => {
  const consumer = getKafka().consumer({
    groupId,
    sessionTimeout: config.kafka.sessionTimeout,
    heartbeatInterval: config.kafka.heartbeatInterval,
    autoCommit: false,
  });
  await consumer.connect();
  logger.info('Kafka consumer connected', { groupId });
  return consumer;
};

module.exports = { createProducer, createConsumer, publish };

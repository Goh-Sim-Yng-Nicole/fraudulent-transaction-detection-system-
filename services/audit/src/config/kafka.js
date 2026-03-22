const { Kafka, Partitioners, CompressionTypes, logLevel: KafkaLogLevel } = require('kafkajs');
const config = require('./index');
const logger = require('./logger');

let kafka = null;

const kafkaLogLevelMap = {
  [KafkaLogLevel.NOTHING]: 'silent',
  [KafkaLogLevel.ERROR]: 'error',
  [KafkaLogLevel.WARN]: 'warn',
  [KafkaLogLevel.INFO]: 'info',
  [KafkaLogLevel.DEBUG]: 'debug',
};

// Handles create kafka.
const createKafka = () => {
  if (kafka) return kafka;

  kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    connectionTimeout: 10000,
    requestTimeout: 30000,
    retry: config.kafka.retry,
    logCreator: () => ({ namespace, level, label, log }) => {
      const mappedLevel = kafkaLogLevelMap[level] || 'debug';
      const { message, ...extra } = log;
      if (level <= KafkaLogLevel.WARN) {
        logger[mappedLevel](`[Kafka:${namespace}] ${message}`, extra);
      }
    },
  });

  return kafka;
};

// Handles create consumer.
const createConsumer = async () => {
  const k = createKafka();

  const consumer = k.consumer({
    groupId: config.kafka.groupId,
    sessionTimeout: config.kafka.sessionTimeout,
    heartbeatInterval: config.kafka.heartbeatInterval,
    maxWaitTimeInMs: 100,
    retry: config.kafka.retry,
    autoCommit: false,
  });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error('Kafka consumer crashed', {
      error: payload.error?.message,
      groupId: payload.groupId,
      restart: payload.restart,
    });
  });

  consumer.on(consumer.events.DISCONNECT, () => {
    logger.warn('Kafka consumer disconnected');
  });

  consumer.on(consumer.events.CONNECT, () => {
    logger.info('Kafka consumer connected', { groupId: config.kafka.groupId });
  });

  await consumer.connect();
  return consumer;
};

// Handles create producer.
const createProducer = async () => {
  const k = createKafka();

  const producer = k.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    allowAutoTopicCreation: true,
    idempotent: true,
    maxInFlightRequests: 1,
    transactionTimeout: 30000,
  });

  producer.on(producer.events.CONNECT, () => {
    logger.info('Kafka producer connected');
  });

  producer.on(producer.events.DISCONNECT, () => {
    logger.warn('Kafka producer disconnected');
  });

  await producer.connect();
  return producer;
};

// Handles publish.
const publish = async (producer, topic, partitionKey, payload, headers = {}) => {
  const messageHeaders = {
    'content-type': 'application/json',
    'service-source': config.serviceName,
    'service-version': config.serviceVersion,
    'published-at': new Date().toISOString(),
    ...headers,
  };

  const result = await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: partitionKey ? String(partitionKey) : null,
        value: JSON.stringify(payload),
        headers: messageHeaders,
      },
    ],
  });

  logger.info('Kafka message published', {
    topic,
    partitionKey,
    partition: result[0]?.partition,
    offset: result[0]?.baseOffset,
  });

  return result;
};

module.exports = { createKafka, createConsumer, createProducer, publish };
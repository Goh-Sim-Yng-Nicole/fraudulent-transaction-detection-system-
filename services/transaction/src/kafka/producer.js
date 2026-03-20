const { Kafka, CompressionTypes } = require('kafkajs');
const config = require('../config');

let producer = null;

const createProducer = async () => {
  if (producer) return producer;

  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers
  });

  producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  return producer;
};

const publish = async (topic, key, payload, headers = {}) => {
  const activeProducer = await createProducer();
  await activeProducer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: key ? String(key) : null,
        value: JSON.stringify(payload),
        headers: {
          'content-type': 'application/json',
          'service-source': config.serviceName,
          ...headers
        }
      }
    ]
  });
};

const disconnectProducer = async () => {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
};

module.exports = {
  createProducer,
  publish,
  disconnectProducer
};

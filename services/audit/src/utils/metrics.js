const client = require('prom-client');
const config = require('../config');

const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: `${config.metrics.prefix}_`,
  labels: { service: config.serviceName, version: config.serviceVersion, env: config.env },
});

const auditEventsTotal = new client.Counter({
  name: `${config.metrics.prefix}_events_total`,
  help: 'Total audit events recorded',
  labelNames: ['event_type', 'topic'],
  registers: [register],
});

const auditDuration = new client.Histogram({
  name: `${config.metrics.prefix}_duration_ms`,
  help: 'Time to record audit event (ms)',
  labelNames: ['topic'],
  buckets: [5, 10, 25, 50, 100, 250, 500],
  registers: [register],
});

const kafkaMessagesConsumed = new client.Counter({
  name: `${config.metrics.prefix}_kafka_messages_total`,
  help: 'Total Kafka messages consumed',
  labelNames: ['topic', 'status'],
  registers: [register],
});

const errorsTotal = new client.Counter({
  name: `${config.metrics.prefix}_errors_total`,
  help: 'Total errors',
  labelNames: ['component', 'type'],
  registers: [register],
});

module.exports = { register, auditEventsTotal, auditDuration, kafkaMessagesConsumed, errorsTotal };
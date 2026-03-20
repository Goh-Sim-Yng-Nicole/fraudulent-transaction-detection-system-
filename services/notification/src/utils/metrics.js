const client = require('prom-client');
const config = require('../config');

const register = new client.Registry();
client.collectDefaultMetrics({
  register,
  prefix: `${config.metrics.prefix}_`,
  labels: {
    service: config.serviceName,
    version: config.serviceVersion,
    env: config.env,
  },
});

const notificationsTotal = new client.Counter({
  name: `${config.metrics.prefix}_notifications_total`,
  help: 'Total number of notification batches processed',
  labelNames: ['decision', 'status'],
  registers: [register],
});

const notificationDuration = new client.Histogram({
  name: `${config.metrics.prefix}_notification_duration_ms`,
  help: 'Time taken to process notifications (ms)',
  labelNames: ['decision'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

const notificationsSentTotal = new client.Counter({
  name: `${config.metrics.prefix}_notifications_sent_total`,
  help: 'Total notifications sent by type and status',
  labelNames: ['type', 'recipient', 'status'],
  registers: [register],
});

const notificationRetries = new client.Counter({
  name: `${config.metrics.prefix}_notification_retries_total`,
  help: 'Total notification retry attempts',
  labelNames: ['type', 'attempt'],
  registers: [register],
});

const kafkaMessagesConsumed = new client.Counter({
  name: `${config.metrics.prefix}_kafka_messages_consumed_total`,
  help: 'Total Kafka messages consumed',
  labelNames: ['topic', 'status'],
  registers: [register],
});

const kafkaDlqTotal = new client.Counter({
  name: `${config.metrics.prefix}_kafka_dlq_total`,
  help: 'Total messages sent to DLQ',
  labelNames: ['reason'],
  registers: [register],
});

const errorsTotal = new client.Counter({
  name: `${config.metrics.prefix}_errors_total`,
  help: 'Total errors encountered',
  labelNames: ['component', 'type'],
  registers: [register],
});

module.exports = {
  register,
  notificationsTotal,
  notificationDuration,
  notificationsSentTotal,
  notificationRetries,
  kafkaMessagesConsumed,
  kafkaDlqTotal,
  errorsTotal,
};
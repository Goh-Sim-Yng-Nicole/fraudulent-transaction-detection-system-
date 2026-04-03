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

const decisionsTotal = new client.Counter({
  name: `${config.metrics.prefix}_decisions_total`,
  help: 'Total number of decisions made',
  labelNames: ['decision'],
  registers: [register],
});

const decisionDuration = new client.Histogram({
  name: `${config.metrics.prefix}_decision_duration_ms`,
  help: 'Time taken to make and persist a decision (ms)',
  labelNames: ['decision'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

const overridesTotal = new client.Counter({
  name: `${config.metrics.prefix}_overrides_total`,
  help: 'Total number of override decisions',
  labelNames: ['override_type'],
  registers: [register],
});

const riskScoreDistribution = new client.Histogram({
  name: `${config.metrics.prefix}_risk_score_distribution`,
  help: 'Distribution of risk scores for decisions',
  labelNames: ['decision'],
  buckets: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  registers: [register],
});

const dbOperationDuration = new client.Histogram({
  name: `${config.metrics.prefix}_db_operation_duration_ms`,
  help: 'Database operation duration (ms)',
  labelNames: ['operation'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [register],
});

const kafkaMessagesConsumed = new client.Counter({
  name: `${config.metrics.prefix}_kafka_messages_consumed_total`,
  help: 'Total Kafka messages consumed',
  labelNames: ['topic', 'status'],
  registers: [register],
});

const kafkaMessagesPublished = new client.Counter({
  name: `${config.metrics.prefix}_kafka_messages_published_total`,
  help: 'Total Kafka messages published',
  labelNames: ['topic', 'decision'],
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
  decisionsTotal,
  decisionDuration,
  overridesTotal,
  riskScoreDistribution,
  dbOperationDuration,
  kafkaMessagesConsumed,
  kafkaMessagesPublished,
  errorsTotal,
};
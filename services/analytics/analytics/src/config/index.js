require('dotenv').config();

const flagEnabled = (value, fallback = false) => {
  if (value == null) return fallback;
  return String(value).toLowerCase() === 'true';
};

const strictConfig = flagEnabled(process.env.SECURITY_ENFORCE_STRICT_CONFIG, false)
  || String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const managerPassword = process.env.MANAGER_PASSWORD || 'manager123';
const managerToken = process.env.MANAGER_API_TOKEN || process.env.MANAGER_JWT_SECRET || 'manager-dev-token';

if (strictConfig && (
  managerPassword === 'manager123'
  || managerToken === 'manager-dev-token'
  || managerToken === 'manager-dev-secret-change-in-prod'
)) {
  throw new Error('Manager credentials must be overridden when strict security is enabled');
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8006,
  serviceName: process.env.SERVICE_NAME || 'analytics',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    db: parseInt(process.env.REDIS_DB, 10) || 5,
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 10000,
    commandTimeout: 3000,
    disabled: flagEnabled(process.env.REDIS_DISABLED, true),
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'analytics',
    groupId: process.env.KAFKA_GROUP_ID || 'analytics-group',
    enableConsumer: process.env.KAFKA_ENABLE_CONSUMER !== 'false',
    topics: (process.env.KAFKA_TOPICS || 'transaction.finalised,transaction.flagged,transaction.reviewed,appeal.created,appeal.resolved')
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean),
    sessionTimeout: parseInt(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT, 10) || 30000,
    heartbeatInterval: parseInt(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL, 10) || 3000,
    retry: {
      initialRetryTime: parseInt(process.env.KAFKA_RETRY_INITIAL_DELAY_MS, 10) || 100,
      retries: parseInt(process.env.KAFKA_RETRY_MAX_ATTEMPTS, 10) || 8,
      multiplier: parseInt(process.env.KAFKA_RETRY_MULTIPLIER, 10) || 2,
      maxRetryTime: parseInt(process.env.KAFKA_RETRY_MAX_DELAY_MS, 10) || 30000,
    },
  },

  analytics: {
    retentionHours: parseInt(process.env.METRICS_RETENTION_HOURS, 10) || 168,
    aggregationIntervalSeconds: parseInt(process.env.METRICS_AGGREGATION_INTERVAL_SECONDS, 10) || 60,
    enableRealTimeUpdates: process.env.ENABLE_REAL_TIME_UPDATES !== 'false',
    projectionPrefix: process.env.ANALYTICS_PROJECTION_PREFIX || 'analytics',
  },

  websocket: {
    enabled: process.env.WS_ENABLED !== 'false',
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL, 10) || 30000,
  },

  manager: {
    username: process.env.MANAGER_USERNAME || 'manager',
    password: managerPassword,
    token: managerToken,
  },

  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT, 10) || 9098,
    prefix: 'analytics',
  },
};

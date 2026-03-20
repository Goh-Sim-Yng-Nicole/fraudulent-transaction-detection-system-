require('dotenv').config();

const normalizeDatabaseUrl = (value) => {
  if (!value) return null;
  return String(value).replace('postgresql+asyncpg://', 'postgres://').replace('postgresql://', 'postgres://');
};

const parseDatabaseUrl = (value) => {
  const normalized = normalizeDatabaseUrl(value);
  if (!normalized) return {};
  try {
    const parsed = new URL(normalized);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : undefined,
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      connectionString: normalized,
    };
  } catch (_err) {
    return { connectionString: normalized };
  }
};

const dbFromUrl = parseDatabaseUrl(process.env.DATABASE_URL);

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8003,
  serviceName: process.env.SERVICE_NAME || 'appeal',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  db: {
    host: process.env.DB_HOST || dbFromUrl.host || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || dbFromUrl.port || 5432,
    database: process.env.DB_NAME || dbFromUrl.database || 'ftds_appeal',
    user: process.env.DB_USER || dbFromUrl.user || 'postgres',
    password: process.env.DB_PASSWORD || dbFromUrl.password || 'postgres',
    max: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 2000,
    connectionString: dbFromUrl.connectionString,
  },

  transactionServiceUrl: process.env.TRANSACTION_SERVICE_URL || process.env.TRANSACTION_BASE_URL || 'http://transaction:8000',

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'appeal',
    sessionTimeout: parseInt(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT, 10) || 30000,
    heartbeatInterval: parseInt(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL, 10) || 3000,
    outputTopicCreated: process.env.KAFKA_OUTPUT_TOPIC_APPEAL_CREATED || 'appeal.created',
    outputTopicResolved: process.env.KAFKA_OUTPUT_TOPIC_APPEAL_RESOLVED || 'appeal.resolved',
    dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'appeal.dlq',
    retry: {
      initialRetryTime: 100,
      retries: 8,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  },
};

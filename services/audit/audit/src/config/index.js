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
  port: parseInt(process.env.PORT, 10) || 8007,
  serviceName: process.env.SERVICE_NAME || 'audit',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  db: {
    host: process.env.DB_HOST || dbFromUrl.host || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || dbFromUrl.port || 5432,
    database: process.env.DB_NAME || dbFromUrl.database || 'ftds_audit',
    user: process.env.DB_USER || dbFromUrl.user || 'postgres',
    password: process.env.DB_PASSWORD || dbFromUrl.password || 'postgres',
    max: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 2000,
    connectionString: dbFromUrl.connectionString,
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'audit',
    groupId: process.env.KAFKA_GROUP_ID || 'audit-group',
    sessionTimeout: parseInt(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT, 10) || 30000,
    heartbeatInterval: parseInt(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL, 10) || 3000,
    topics: (process.env.KAFKA_TOPICS || 'transaction.created,transaction.scored,transaction.finalised,transaction.flagged,transaction.reviewed,appeal.created,appeal.resolved').split(','),
    retry: {
      initialRetryTime: 100,
      retries: 8,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  },

  audit: {
    enableHashVerification: process.env.ENABLE_HASH_VERIFICATION !== 'false',
    retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS, 10) || 2555,
    enableChainValidation: process.env.ENABLE_CHAIN_VALIDATION !== 'false',
  },

  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT, 10) || 9097,
    prefix: 'audit',
  },
};

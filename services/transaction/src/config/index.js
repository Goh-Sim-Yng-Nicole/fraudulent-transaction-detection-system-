require('dotenv').config();

const normalizeDatabaseUrl = (value) => {
  if (!value) return null;
  return String(value)
    .replace('postgresql+asyncpg://', 'postgres://')
    .replace('postgresql://', 'postgres://');
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
  } catch (_error) {
    return { connectionString: normalized };
  }
};

const dbFromUrl = parseDatabaseUrl(process.env.DATABASE_URL);

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8000,
  serviceName: process.env.SERVICE_NAME || 'transaction',
  serviceVersion: process.env.SERVICE_VERSION || '2.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  db: {
    host: process.env.DB_HOST || dbFromUrl.host || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || dbFromUrl.port || 5432,
    database: process.env.DB_NAME || dbFromUrl.database || 'ftds_transaction',
    user: process.env.DB_USER || dbFromUrl.user || 'postgres',
    password: process.env.DB_PASSWORD || dbFromUrl.password || 'postgres',
    connectionString: dbFromUrl.connectionString,
    max: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 10,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 5000,
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'transaction-service',
    groupId: process.env.KAFKA_GROUP_ID || 'transaction-service',
    topics: {
      transactionCreated: process.env.KAFKA_TOPIC_TRANSACTION_CREATED || process.env.TOPIC_TRANSACTION_CREATED || 'transaction.created',
      transactionFlagged: process.env.KAFKA_TOPIC_TRANSACTION_FLAGGED || process.env.TOPIC_TRANSACTION_FLAGGED || 'transaction.flagged',
      transactionFinalised: process.env.KAFKA_TOPIC_TRANSACTION_FINALISED || process.env.TOPIC_TRANSACTION_FINALISED || 'transaction.finalised',
      transactionReviewed: process.env.KAFKA_TOPIC_TRANSACTION_REVIEWED || process.env.TOPIC_TRANSACTION_REVIEWED || 'transaction.reviewed',
      appealResolved: process.env.KAFKA_TOPIC_APPEAL_RESOLVED || process.env.TOPIC_APPEAL_RESOLVED || 'appeal.resolved'
    }
  }
};

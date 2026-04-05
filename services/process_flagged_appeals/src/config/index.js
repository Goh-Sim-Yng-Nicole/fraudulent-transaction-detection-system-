require('dotenv').config();

const flagEnabled = (value, fallback = false) => {
  if (value == null) return fallback;
  return String(value).toLowerCase() === 'true';
};

const strictConfig = flagEnabled(process.env.SECURITY_ENFORCE_STRICT_CONFIG, false)
  || String(process.env.NODE_ENV || '').toLowerCase() === 'production';

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
const analystPassword = process.env.ANALYST_PASSWORD || 'analyst123';
const analystToken = process.env.ANALYST_API_TOKEN || process.env.ANALYST_JWT_SECRET || 'analyst-dev-token';

if (strictConfig && (
  analystPassword === 'analyst123'
  || analystToken === 'analyst-dev-token'
  || analystToken === 'analyst-dev-secret-change-in-prod'
)) {
  throw new Error('Analyst credentials must be overridden when strict security is enabled');
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8002,
  serviceName: process.env.SERVICE_NAME || 'process_flagged_appeals',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  enableBrowserIsolation: process.env.ENABLE_BROWSER_ISOLATION === 'true',

  db: {
    host: process.env.DB_HOST || dbFromUrl.host || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || dbFromUrl.port || 5432,
    database: process.env.DB_NAME || dbFromUrl.database || 'ftds_fraud_review',
    user: process.env.DB_USER || dbFromUrl.user || 'postgres',
    password: process.env.DB_PASSWORD || dbFromUrl.password || 'postgres',
    max: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 2000,
    connectionString: dbFromUrl.connectionString,
  },
  appealService: {
    baseUrl: process.env.APPEAL_SERVICE_URL || process.env.APPEAL_BASE_URL || 'http://appeal:8003',
    timeoutMs: parseInt(process.env.APPEAL_SERVICE_TIMEOUT_MS, 10) || 4000,
  },
  transactionService: {
    baseUrl: process.env.TRANSACTION_SERVICE_URL || process.env.TRANSACTION_BASE_URL || 'http://transaction:8000',
    timeoutMs: parseInt(process.env.TRANSACTION_SERVICE_TIMEOUT_MS, 10) || 4000,
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'process_flagged_appeals',
    groupId: process.env.KAFKA_GROUP_ID || 'human-verification-group',
    sessionTimeout: parseInt(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT, 10) || 30000,
    heartbeatInterval: parseInt(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL, 10) || 3000,
    inputTopicFlagged: process.env.KAFKA_INPUT_TOPIC_FLAGGED || 'transaction.flagged',
    outputTopicReviewed: process.env.KAFKA_OUTPUT_TOPIC_REVIEWED || 'transaction.reviewed',
    dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'transaction.review.dlq',
    // Appeal command bus
    outputTopicAppealCommands: process.env.KAFKA_OUTPUT_TOPIC_APPEAL_COMMANDS || 'appeal.commands',
    appealResponseGroupId: process.env.KAFKA_APPEAL_RESPONSE_GROUP_ID || 'fraud-review-appeal-response-group',
    inputTopicAppealResponses: process.env.KAFKA_INPUT_TOPIC_APPEAL_RESPONSES || 'appeal.command.responses',
    appealCommandTimeoutMs: parseInt(process.env.KAFKA_APPEAL_COMMAND_TIMEOUT_MS, 10) || 8000,
    retry: {
      initialRetryTime: 100,
      retries: 8,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  },

  analyst: {
    username: process.env.ANALYST_USERNAME || 'analyst',
    password: analystPassword,
    token: analystToken,
  },
};

require('dotenv').config();

const parseBoolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const parseInteger = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const externalDecisionUrl = (
  process.env.OUTSYSTEMS_DECISION_URL
  || process.env.DECISION_ENGINE_SERVICE_URL
  || process.env.DECISION_BASE_URL
  || ''
).trim();

const approveMax = parseInteger(process.env.THRESHOLD_APPROVE_MAX || process.env.APPROVE_MAX_SCORE, 49);
const flagMin = parseInteger(process.env.THRESHOLD_FLAG_MIN, approveMax + 1);
const flagMax = parseInteger(process.env.THRESHOLD_FLAG_MAX || process.env.FLAG_MAX_SCORE, 79);
const declineMin = parseInteger(process.env.THRESHOLD_DECLINE_MIN, flagMax + 1);

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8008,
  serviceName: process.env.SERVICE_NAME || 'detect-fraud',
  serviceVersion: process.env.SERVICE_VERSION || '2.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'detect-fraud',
    groupId: process.env.KAFKA_GROUP_ID || 'detect-fraud-group',
    inputTopic: process.env.KAFKA_INPUT_TOPIC || process.env.TOPIC_TRANSACTION_CREATED || 'transaction.created',
    outputTopic: process.env.KAFKA_OUTPUT_TOPIC || process.env.TOPIC_TRANSACTION_SCORED || 'transaction.scored',
    flaggedTopic: process.env.KAFKA_OUTPUT_TOPIC_FLAGGED || process.env.TOPIC_TRANSACTION_FLAGGED || 'transaction.flagged',
    finalisedTopic: process.env.KAFKA_OUTPUT_TOPIC_FINALISED || process.env.TOPIC_TRANSACTION_FINALISED || 'transaction.finalised',
    dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'detect-fraud.dlq',
    retry: {
      initialRetryTime: parseInteger(process.env.KAFKA_RETRY_INITIAL_DELAY_MS, 100),
      retries: parseInteger(process.env.KAFKA_RETRY_MAX_ATTEMPTS, 8),
      multiplier: parseInteger(process.env.KAFKA_RETRY_MULTIPLIER, 2),
      maxRetryTime: parseInteger(process.env.KAFKA_RETRY_MAX_DELAY_MS, 30000),
    },
  },

  mlScoring: {
    url: process.env.FRAUD_SCORE_URL || process.env.ML_SCORING_SERVICE_URL || 'http://fraud-score:8001/score',
    timeoutMs: parseInt(process.env.ML_SCORING_TIMEOUT_MS, 10) || 3000
  },

  redis: {
    host: process.env.REDIS_HOST || '',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 3,
    disabled: String(process.env.REDIS_DISABLED || 'true').toLowerCase() === 'true'
  },

  rules: {
    highRiskCountries: (process.env.HIGH_RISK_COUNTRIES || 'NG,RU,CN,PK').split(',').map((value) => value.trim()).filter(Boolean),
    highAmountThreshold: parseFloat(process.env.HIGH_AMOUNT_THRESHOLD || '5000'),
    suspiciousAmountThreshold: parseFloat(process.env.SUSPICIOUS_AMOUNT_THRESHOLD || '10000'),
    maxTxnPerHour: parseInt(process.env.VELOCITY_MAX_COUNT_PER_HOUR || '8', 10),
    maxAmountPerHour: parseFloat(process.env.VELOCITY_MAX_AMOUNT_PER_HOUR || '15000')
  },

  combination: {
    rulesWeight: parseFloat(process.env.COMBINATION_RULES_WEIGHT || '0.45'),
    mlWeight: parseFloat(process.env.COMBINATION_ML_WEIGHT || '0.55'),
    mlFlagThreshold: parseFloat(process.env.ML_FLAG_THRESHOLD || '70')
  },

  decision: {
    outsystemsUrl: externalDecisionUrl || null,
    timeoutMs: parseInteger(process.env.OUTSYSTEMS_DECISION_TIMEOUT_MS, 5000),
    localFallbackEnabled: parseBoolean(
      process.env.ENABLE_LOCAL_DECISION_FALLBACK,
      !externalDecisionUrl
    ),
    thresholds: {
      approveMax,
      flagMin,
      flagMax,
      declineMin,
      rulesFlaggedAutoDecline: parseBoolean(process.env.THRESHOLD_RULES_FLAGGED_AUTO_DECLINE, false),
      certaintyAutoDeclineEnabled: parseBoolean(process.env.THRESHOLD_CERTAINTY_AUTO_DECLINE_ENABLED, false),
      certaintyDeclineMinScore: parseInteger(process.env.THRESHOLD_CERTAINTY_DECLINE_MIN_SCORE, 70),
      certaintyDeclineMinConfidence: parseNumber(process.env.THRESHOLD_CERTAINTY_DECLINE_MIN_CONFIDENCE, 0.9),
      highConfidenceApprove: parseNumber(process.env.THRESHOLD_HIGH_CONFIDENCE_APPROVE, 0.95),
      lowConfidenceFlag: parseNumber(process.env.THRESHOLD_LOW_CONFIDENCE_FLAG, 0.6),
      highValueAmount: parseNumber(
        process.env.THRESHOLD_HIGH_VALUE_AMOUNT || process.env.SUSPICIOUS_AMOUNT_THRESHOLD,
        10000
      ),
      highValueAutoFlag: parseBoolean(process.env.THRESHOLD_HIGH_VALUE_AUTO_FLAG, false),
    },
    businessRules: {
      autoApproveWhitelist: (process.env.AUTO_APPROVE_WHITELIST_CUSTOMERS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      autoDeclineBlacklist: (process.env.AUTO_DECLINE_BLACKLIST_CUSTOMERS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      requireManualReviewCountries: (
        process.env.REQUIRE_MANUAL_REVIEW_COUNTRIES
        || process.env.HIGH_RISK_COUNTRIES
        || 'NG,RU,CN,PK'
      )
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    },
  }
};

require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3005,
  serviceName: process.env.SERVICE_NAME || 'decision-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  db: {
    host: process.env.DB_HOST || process.env.POSTGRES_DECISION_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.POSTGRES_DECISION_PORT, 10) || 5432,
    database: process.env.DB_NAME || process.env.POSTGRES_DECISION_DB || 'ftds_decision',
    user: process.env.DB_USER || process.env.POSTGRES_DECISION_USER || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_DECISION_PASSWORD || 'postgres',
    max: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 2000,
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'decision-service',
    groupId: process.env.KAFKA_GROUP_ID || 'decision-group',
    sessionTimeout: parseInt(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT, 10) || 30000,
    heartbeatInterval: parseInt(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL, 10) || 3000,
    inputTopic: process.env.KAFKA_INPUT_TOPIC || 'transaction.scored',
    reviewedTopic: process.env.KAFKA_INPUT_TOPIC_REVIEWED || 'transaction.reviewed',
    appealResolvedTopic: process.env.KAFKA_INPUT_TOPIC_APPEAL_RESOLVED || 'appeal.resolved',
    outputTopicApproved: process.env.KAFKA_OUTPUT_TOPIC_APPROVED || 'transaction.finalised',
    outputTopicFlagged: process.env.KAFKA_OUTPUT_TOPIC_FLAGGED || 'transaction.flagged',
    dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'transaction.decision.dlq',
    retry: {
      initialRetryTime: 100,
      retries: 8,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  },

  thresholds: {
    approveMax: parseInt(process.env.THRESHOLD_APPROVE_MAX || process.env.APPROVE_MAX_SCORE, 10) || 49,
    flagMin: parseInt(process.env.THRESHOLD_FLAG_MIN, 10) || 50,
    flagMax: parseInt(process.env.THRESHOLD_FLAG_MAX || process.env.FLAG_MAX_SCORE, 10) || 75,
    declineMin: parseInt(process.env.THRESHOLD_DECLINE_MIN, 10) || 76,
    rulesFlaggedAutoDecline: process.env.THRESHOLD_RULES_FLAGGED_AUTO_DECLINE === 'true',
    certaintyAutoDeclineEnabled: process.env.THRESHOLD_CERTAINTY_AUTO_DECLINE_ENABLED === 'true',
    certaintyDeclineMinScore: parseInt(process.env.THRESHOLD_CERTAINTY_DECLINE_MIN_SCORE, 10) || 70,
    certaintyDeclineMinConfidence: parseFloat(process.env.THRESHOLD_CERTAINTY_DECLINE_MIN_CONFIDENCE) || 0.90,
    highConfidenceApprove: parseFloat(process.env.THRESHOLD_HIGH_CONFIDENCE_APPROVE) || 0.95,
    lowConfidenceFlag: parseFloat(process.env.THRESHOLD_LOW_CONFIDENCE_FLAG) || 0.60,
    highValueAmount: parseFloat(process.env.THRESHOLD_HIGH_VALUE_AMOUNT) || 10000,
    highValueAutoFlag: process.env.THRESHOLD_HIGH_VALUE_AUTO_FLAG === 'true',
  },

  businessRules: {
    autoApproveWhitelist: (process.env.AUTO_APPROVE_WHITELIST_CUSTOMERS || '').split(',').filter(Boolean),
    autoDeclineBlacklist: (process.env.AUTO_DECLINE_BLACKLIST_CUSTOMERS || '').split(',').filter(Boolean),
    requireManualReviewCountries: (process.env.REQUIRE_MANUAL_REVIEW_COUNTRIES || 'NG,RU,CN,PK').split(',').filter(Boolean),
  },

  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT, 10) || 9095,
    prefix: 'decision',
  },
};


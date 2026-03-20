require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8008,
  serviceName: process.env.SERVICE_NAME || 'detect-fraud',
  serviceVersion: process.env.SERVICE_VERSION || '2.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    inputTopic: process.env.KAFKA_INPUT_TOPIC || process.env.TOPIC_TRANSACTION_CREATED || 'transaction.created',
    outputTopic: process.env.KAFKA_OUTPUT_TOPIC || process.env.TOPIC_TRANSACTION_SCORED || 'transaction.scored'
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
  }
};

require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8010,
  serviceName: process.env.SERVICE_NAME || 'notification',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'notification',
    groupId: process.env.KAFKA_GROUP_ID || 'notification-group',
    sessionTimeout: parseInt(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT, 10) || 30000,
    heartbeatInterval: parseInt(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL, 10) || 3000,
    inputTopicFinalised: process.env.KAFKA_INPUT_TOPIC_FINALISED || 'transaction.finalised',
    inputTopicFlagged: process.env.KAFKA_INPUT_TOPIC_FLAGGED || 'transaction.flagged',
    dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'notification.dlq',
    retry: {
      initialRetryTime: 100,
      retries: 8,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  },

  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS, 10) || 3,
    initialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS, 10) || 1000,
    backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER) || 2,
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS, 10) || 10000,
  },

  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    provider: process.env.EMAIL_PROVIDER || 'mock',
    smtp: {
      host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_SMTP_PORT, 10) || 587,
      secure: process.env.EMAIL_SMTP_SECURE === 'true',
      user: process.env.EMAIL_SMTP_USER,
      password: process.env.EMAIL_SMTP_PASSWORD,
    },
    from: {
      address: process.env.EMAIL_FROM_ADDRESS || 'noreply@frauddetection.com',
      name: process.env.EMAIL_FROM_NAME || 'Fraud Detection System',
    },
  },

  sms: {
    enabled: process.env.SMS_ENABLED === 'true',
    provider: process.env.SMS_PROVIDER || 'mock',
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER,
    },
  },

  notificationRules: {
    notifyOnApproved: process.env.NOTIFY_ON_APPROVED === 'true',
    notifyOnDeclined: process.env.NOTIFY_ON_DECLINED === 'true',
    notifyOnFlagged: process.env.NOTIFY_ON_FLAGGED === 'true',

    approved: {
      notifyCustomerEmail: process.env.APPROVED_NOTIFY_CUSTOMER_EMAIL === 'true',
      notifyCustomerSms: process.env.APPROVED_NOTIFY_CUSTOMER_SMS === 'true',
    },

    declined: {
      notifyCustomerEmail: process.env.DECLINED_NOTIFY_CUSTOMER_EMAIL === 'true',
      notifyCustomerSms: process.env.DECLINED_NOTIFY_CUSTOMER_SMS === 'true',
      notifyFraudTeamEmail: process.env.DECLINED_NOTIFY_FRAUD_TEAM_EMAIL === 'true',
    },

    flagged: {
      notifyCustomerEmail: process.env.FLAGGED_NOTIFY_CUSTOMER_EMAIL === 'true',
      notifyCustomerSms: process.env.FLAGGED_NOTIFY_CUSTOMER_SMS === 'true',
      notifyFraudTeamEmail: process.env.FLAGGED_NOTIFY_FRAUD_TEAM_EMAIL === 'true',
      notifyFraudTeamSms: process.env.FLAGGED_NOTIFY_FRAUD_TEAM_SMS === 'true',
    },
  },

  rateLimit: {
    emailPerMinute: parseInt(process.env.RATE_LIMIT_EMAIL_PER_MINUTE, 10) || 60,
    smsPerMinute: parseInt(process.env.RATE_LIMIT_SMS_PER_MINUTE, 10) || 30,
  },

  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT, 10) || 9096,
    prefix: 'notification',
  },
  contacts: {
    customer: {
      fallbackEmail: process.env.NOTIFICATION_CUSTOMER_FALLBACK_EMAIL || 'demo-customer@frauddetection.com',
      fallbackPhone: process.env.NOTIFICATION_CUSTOMER_FALLBACK_PHONE || '+15550000000',
    },
    fraudTeam: {
      email: process.env.NOTIFICATION_FRAUD_TEAM_EMAIL || 'fraud-team@frauddetection.com',
      phone: process.env.NOTIFICATION_FRAUD_TEAM_PHONE || '+15550000001',
    },
  },
  customerPortalUrl: process.env.CUSTOMER_PORTAL_URL || 'http://localhost:8088/banking.html',
};

require('dotenv').config();

const flagEnabled = (value, fallback = true) => {
  if (value == null) return fallback;
  return String(value).toLowerCase() === 'true';
};

const strictConfig = flagEnabled(process.env.SECURITY_ENFORCE_STRICT_CONFIG, false)
  || String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const insecureSecretValues = new Set([
  'change-me-use-a-long-random-secret-in-production',
  'ftds-dev-secret-change-in-production-32chars',
  'dev-secret-123',
]);

const requireValue = (name, value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${name} must be configured`);
  }
  return normalized;
};

const requireSafeSecret = (name, value) => {
  const normalized = requireValue(name, value);
  if (strictConfig && (normalized.length < 32 || insecureSecretValues.has(normalized))) {
    throw new Error(`${name} must be a strong non-default secret when strict security is enabled`);
  }
  return normalized;
};

const parsePermissions = (value, fallback = []) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized
    .split(',')
    .map((permission) => permission.trim())
    .filter(Boolean);
};

const staffUsers = Object.fromEntries(
  [
    {
      envPrefix: 'ANALYST',
      username: process.env.ANALYST_USERNAME || 'analyst',
      password: process.env.ANALYST_PASSWORD || 'analyst123',
      role: 'fraud_analyst',
      displayName: process.env.ANALYST_DISPLAY_NAME || 'Fraud Analyst',
      permissions: parsePermissions(process.env.ANALYST_PERMISSIONS, [
        'reviews:read',
        'reviews:claim',
        'reviews:decide',
        'appeals:read',
        'appeals:claim',
        'appeals:decide',
      ]),
    },
    {
      envPrefix: 'MANAGER',
      username: process.env.MANAGER_USERNAME || 'manager',
      password: process.env.MANAGER_PASSWORD || 'manager123',
      role: 'fraud_manager',
      displayName: process.env.MANAGER_DISPLAY_NAME || 'Fraud Manager',
      permissions: parsePermissions(process.env.MANAGER_PERMISSIONS, [
        'reviews:read',
        'reviews:manage',
        'appeals:read',
        'appeals:manage',
        'analytics:read',
        'audit:read',
      ]),
    },
    {
      envPrefix: 'OPS_READONLY',
      username: process.env.OPS_READONLY_USERNAME || 'opsviewer',
      password: process.env.OPS_READONLY_PASSWORD || 'opsviewer123',
      role: 'ops_readonly',
      displayName: process.env.OPS_READONLY_DISPLAY_NAME || 'Ops Readonly',
      permissions: parsePermissions(process.env.OPS_READONLY_PERMISSIONS, [
        'analytics:read',
        'audit:read',
        'observability:read',
      ]),
    },
    {
      envPrefix: 'OPS_ADMIN',
      username: process.env.OPS_ADMIN_USERNAME || 'opsadmin',
      password: process.env.OPS_ADMIN_PASSWORD || 'opsadmin123',
      role: 'ops_admin',
      displayName: process.env.OPS_ADMIN_DISPLAY_NAME || 'Ops Admin',
      permissions: parsePermissions(process.env.OPS_ADMIN_PERMISSIONS, [
        'analytics:read',
        'audit:read',
        'observability:read',
        'observability:admin',
        'mail:read',
      ]),
    },
  ].map((user) => {
    const username = String(user.username || '').trim();
    if (!username) {
      return null;
    }

    if (strictConfig && user.password && user.password.endsWith('123')) {
      throw new Error(`${user.envPrefix}_PASSWORD must be overridden when strict security is enabled`);
    }

    return [
      username,
      {
        username,
        password: String(user.password || ''),
        role: user.role,
        displayName: user.displayName,
        permissions: user.permissions,
      },
    ];
  }).filter(Boolean)
);

const parseCorsOrigins = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return [
      'http://localhost',
      'http://127.0.0.1',
      'http://localhost:8088',
      'http://127.0.0.1:8088',
    ];
  }
  if (normalized === '*') {
    return '*';
  }
  return normalized
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const externalDecisionUrl = (
  process.env.DECISION_ENGINE_SERVICE_URL
  || process.env.DECISION_BASE_URL
  || ''
).trim();

const jwtSecret = requireSafeSecret('JWT_SECRET', process.env.JWT_SECRET);
const corsOrigin = parseCorsOrigins(process.env.CORS_ORIGIN);
const corsCredentials = process.env.CORS_CREDENTIALS === 'true';

if (strictConfig && corsOrigin === '*') {
  throw new Error('CORS_ORIGIN cannot be "*" when strict security is enabled');
}

if (corsOrigin === '*' && corsCredentials) {
  throw new Error('CORS_CREDENTIALS=true cannot be combined with CORS_ORIGIN="*"');
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 8004,
  serviceName: process.env.SERVICE_NAME || 'gateway',
  logLevel: process.env.LOG_LEVEL || 'info',

  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    issuer: process.env.JWT_ISSUER || 'fraud-detection-platform',
    customerIssuer: process.env.CUSTOMER_JWT_ISSUER || 'ftds-customer-service',
  },
  auth: {
    staffCookieName: process.env.STAFF_SESSION_COOKIE_NAME || 'ftds_staff_token',
    sessionMaxAgeMs: parseInt(process.env.STAFF_SESSION_MAX_AGE_MS, 10) || 12 * 60 * 60 * 1000,
    secureCookies: flagEnabled(process.env.COOKIE_SECURE_ONLY, strictConfig),
    staffUsers,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT, 10) || 10000,
    disabled: flagEnabled(process.env.REDIS_DISABLED, true),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
    skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS === 'true',
  },
  transactionRateLimit: {
    windowMs: parseInt(process.env.TXN_RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.TXN_RATE_LIMIT_MAX_PER_CUSTOMER, 10) || 30,
    keyPrefix: process.env.TXN_RATE_LIMIT_KEY_PREFIX || 'txn:customer:',
  },

  services: {
    user: process.env.USER_SERVICE_URL || process.env.CUSTOMER_BASE_URL || 'http://customer:8005',
    transaction: process.env.TRANSACTION_SERVICE_URL || process.env.TRANSACTION_BASE_URL || 'http://transaction:8000',
    decisionEngine: externalDecisionUrl || null,
    mlScoring: process.env.ML_SCORING_SERVICE_URL || process.env.FRAUD_SCORE_URL || 'http://fraud-score:8001',
    audit: process.env.AUDIT_SERVICE_URL || process.env.AUDIT_BASE_URL || 'http://audit:8007',
    analytics: process.env.ANALYTICS_SERVICE_URL || process.env.ANALYTICS_BASE_URL || 'http://analytics:8006',
    humanVerification: process.env.HUMAN_VERIFICATION_SERVICE_URL || process.env.FRAUD_REVIEW_BASE_URL || 'http://fraud-review:8002',
    appeal: process.env.APPEAL_SERVICE_URL || process.env.APPEAL_BASE_URL || 'http://appeal:8003',
  },
  routeToggles: {
    auth: flagEnabled(process.env.ENABLE_AUTH_ROUTES),
    transactions: flagEnabled(process.env.ENABLE_TRANSACTION_ROUTES),
    decisions: Boolean(externalDecisionUrl) && flagEnabled(process.env.ENABLE_DECISION_ROUTES, true),
    audit: flagEnabled(process.env.ENABLE_AUDIT_ROUTES),
    analytics: flagEnabled(process.env.ENABLE_ANALYTICS_ROUTES),
    humanVerification: flagEnabled(process.env.ENABLE_HUMAN_VERIFICATION_ROUTES),
    appeals: flagEnabled(process.env.ENABLE_APPEAL_ROUTES),
  },

  circuitBreaker: {
    timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT, 10) || 3000,
    errorThresholdPercentage: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD, 10) || 50,
    resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT, 10) || 30000,
  },

  cors: {
    origin: corsOrigin,
    credentials: corsCredentials,
  },

  proxy: {
    timeout: parseInt(process.env.PROXY_TIMEOUT, 10) || 30000,
    retryAttempts: parseInt(process.env.PROXY_RETRY_ATTEMPTS, 10) || 3,
    retryDelay: parseInt(process.env.PROXY_RETRY_DELAY, 10) || 1000,
  },

  metrics: {
    enabled: process.env.METRICS_ENABLED === 'true',
    port: parseInt(process.env.METRICS_PORT, 10) || 9090,
  },

  healthCheck: {
    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10) || 30000,
  },
};

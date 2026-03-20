module.exports = {
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
  },

  USER_ROLES: {
    ADMIN: 'admin',
    USER: 'user',
    SERVICE: 'service',
  },

  RATE_LIMIT_HEADERS: {
    LIMIT: 'X-RateLimit-Limit',
    REMAINING: 'X-RateLimit-Remaining',
    RESET: 'X-RateLimit-Reset',
  },

  REQUEST_ID_HEADER: 'X-Request-ID',
  CORRELATION_ID_HEADER: 'X-Correlation-ID',
  IDEMPOTENCY_KEY_HEADER: 'X-Idempotency-Key',

  CIRCUIT_BREAKER_STATES: {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN',
  },
};
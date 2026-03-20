module.exports = {
  TRANSACTION_STATUS: {
    PENDING: 'PENDING',
    FLAGGED: 'FLAGGED',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED'
  },
  HEADERS: {
    REQUEST_ID: 'x-request-id',
    CORRELATION_ID: 'x-correlation-id',
    IDEMPOTENCY_KEY: 'x-idempotency-key'
  }
};

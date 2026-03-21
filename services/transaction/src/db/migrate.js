const { createPool, query, closePool } = require('./pool');
const logger = require('../config/logger');
const { setTimeout: delay } = require('node:timers/promises');

const ddl = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id VARCHAR(255) NOT NULL,
  sender_name VARCHAR(255),
  recipient_customer_id VARCHAR(255),
  recipient_name VARCHAR(255),
  merchant_id VARCHAR(255) NOT NULL DEFAULT 'FTDS_TRANSFER',
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
  card_type VARCHAR(32) NOT NULL DEFAULT 'CREDIT',
  country VARCHAR(8) NOT NULL,
  hour_utc INTEGER NOT NULL CHECK (hour_utc >= 0 AND hour_utc <= 23),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  fraud_score INTEGER,
  outcome_reason TEXT,
  idempotency_key VARCHAR(255) UNIQUE,
  correlation_id VARCHAR(255),
  request_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_recipient_customer_id ON transactions(recipient_customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

CREATE OR REPLACE FUNCTION set_transaction_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_transaction_updated_at();
`;

const isTransientDatabaseError = (error) => {
  const message = String(error?.message || '');
  return [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
  ].includes(error?.code) || /database system is starting up|connect ECONNREFUSED|Connection terminated unexpectedly/i.test(message);
};

const waitForDatabase = async () => {
  const maxAttempts = 30;
  const delayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await query('SELECT 1');
      if (attempt > 1) {
        logger.info('Transaction database became reachable', { attempt, maxAttempts });
      }
      return;
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt === maxAttempts) {
        throw error;
      }

      logger.warn('Transaction database not ready yet, retrying migration', {
        attempt,
        maxAttempts,
        delayMs,
        error: error.message,
      });
      await delay(delayMs);
    }
  }
};

const main = async () => {
  createPool();
  try {
    await waitForDatabase();
    await query(ddl);
    logger.info('Transaction migrations applied');
  } catch (error) {
    logger.error('Transaction migration failed', { error: error.message, stack: error.stack });
    process.exitCode = 1;
  } finally {
    await closePool();
  }
};

if (require.main === module) {
  main();
}

module.exports = main;

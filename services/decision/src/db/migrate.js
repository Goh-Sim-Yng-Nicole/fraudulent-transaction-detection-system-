require('dotenv').config();
const { Pool } = require('pg');
const config = require('../config');
const logger = require('../config/logger');

// Handles run migrations.
const runMigrations = async () => {
  logger.info('Running database migrations...');

  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS decisions (
        decision_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id      UUID NOT NULL,
        customer_id         VARCHAR(255) NOT NULL,
        merchant_id         VARCHAR(255),
        
        -- Input data
        risk_score          INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
        ml_score            INTEGER,
        rule_score          INTEGER,
        fraud_flagged       BOOLEAN NOT NULL,
        confidence          DECIMAL(3, 2),
        
        -- Decision output
        decision            VARCHAR(50) NOT NULL CHECK (decision IN ('APPROVED', 'DECLINED', 'FLAGGED')),
        decision_reason     TEXT,
        decision_factors    JSONB DEFAULT '{}',
        
        -- Override tracking
        override_applied    BOOLEAN DEFAULT FALSE,
        override_reason     TEXT,
        override_type       VARCHAR(50),
        
        -- Timestamps
        decided_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        
        -- Audit metadata
        correlation_id      VARCHAR(255),
        decision_version    VARCHAR(50),
        
        -- Indexes for queries
        CONSTRAINT unique_transaction_decision UNIQUE (transaction_id)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS decision_history (
        history_id          BIGSERIAL PRIMARY KEY,
        decision_id         UUID NOT NULL REFERENCES decisions(decision_id),
        transaction_id      UUID NOT NULL,
        
        -- Full snapshot of decision inputs
        fraud_analysis      JSONB NOT NULL,
        original_transaction JSONB,
        
        -- Decision details
        decision            VARCHAR(50) NOT NULL,
        decision_metadata   JSONB DEFAULT '{}',
        
        -- Timestamps
        recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS decision_overrides (
        override_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        decision_id         UUID NOT NULL REFERENCES decisions(decision_id),
        transaction_id      UUID NOT NULL,
        
        -- Override details
        original_decision   VARCHAR(50) NOT NULL,
        new_decision        VARCHAR(50) NOT NULL,
        override_reason     TEXT NOT NULL,
        override_by         VARCHAR(255),
        
        -- Timestamps
        overridden_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decisions_transaction_id ON decisions(transaction_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decisions_customer_id ON decisions(customer_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decisions_decision ON decisions(decision);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decisions_decided_at ON decisions(decided_at);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decisions_correlation_id ON decisions(correlation_id);');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decision_history_transaction_id ON decision_history(transaction_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decision_history_recorded_at ON decision_history(recorded_at);');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decision_overrides_transaction_id ON decision_overrides(transaction_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_decision_overrides_overridden_at ON decision_overrides(overridden_at);');

    logger.info('Migrations completed successfully');
  } catch (err) {
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    throw err;
  } finally {
    await pool.end();
    logger.info('DB pool closed');
  }
};

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = runMigrations;
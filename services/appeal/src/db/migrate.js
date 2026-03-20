const { createPool, closePool } = require('./pool');
const logger = require('../config/logger');

// Handles migrate.
const migrate = async () => {
  const pool = createPool();
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS appeals (
        appeal_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id              UUID NOT NULL,
        customer_id                 VARCHAR(255) NOT NULL,
        source_transaction_status   VARCHAR(50) NOT NULL
                                  CHECK (source_transaction_status IN ('REJECTED', 'FLAGGED')),
        current_status              VARCHAR(50) NOT NULL DEFAULT 'OPEN'
                                  CHECK (current_status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED')),
        resolution                  VARCHAR(50)
                                  CHECK (resolution IN ('UPHOLD', 'REVERSE')),
        appeal_reason               TEXT NOT NULL,
        evidence                    JSONB NOT NULL DEFAULT '{}'::jsonb,
        resolution_notes            TEXT,
        reviewed_by                 VARCHAR(255),
        correlation_id              VARCHAR(255),
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at                 TIMESTAMPTZ
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appeals_status_created_at
      ON appeals (current_status, created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_appeals_customer_created_at
      ON appeals (customer_id, created_at DESC);
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_appeals_one_active_per_transaction
      ON appeals (transaction_id)
      WHERE current_status IN ('OPEN', 'UNDER_REVIEW');
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION set_appeal_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS trg_appeals_updated_at ON appeals;
    `);

    await pool.query(`
      CREATE TRIGGER trg_appeals_updated_at
      BEFORE UPDATE ON appeals
      FOR EACH ROW
      EXECUTE FUNCTION set_appeal_updated_at();
    `);

    logger.info('Appeal schema migration complete');
  } finally {
    await closePool();
  }
};

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    process.exit(1);
  });

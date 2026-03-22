const { createPool, closePool } = require('./pool');
const logger = require('../config/logger');

// Handles migrate.
const migrate = async () => {
  const pool = createPool();
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_reviews (
        review_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id      UUID UNIQUE NOT NULL,
        customer_id         VARCHAR(255) NOT NULL,
        merchant_id         VARCHAR(255),
        source_topic        VARCHAR(100) NOT NULL DEFAULT 'transaction.flagged',
        queue_status        VARCHAR(50) NOT NULL DEFAULT 'PENDING'
                          CHECK (queue_status IN ('PENDING','IN_REVIEW','REVIEWED')),
        previous_decision   VARCHAR(50) NOT NULL DEFAULT 'FLAGGED',
        final_decision      VARCHAR(50)
                          CHECK (final_decision IN ('APPROVED','DECLINED')),
        decision_reason     TEXT,
        risk_score          NUMERIC(5,2),
        payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
        reviewed_by         VARCHAR(255),
        reviewed_role       VARCHAR(50),
        review_notes        TEXT,
        claimed_by          VARCHAR(255),
        claimed_role        VARCHAR(50),
        claimed_at          TIMESTAMPTZ,
        claim_expires_at    TIMESTAMPTZ,
        correlation_id      VARCHAR(255),
        version             INTEGER NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at         TIMESTAMPTZ,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`ALTER TABLE manual_reviews ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(255);`);
    await pool.query(`ALTER TABLE manual_reviews ADD COLUMN IF NOT EXISTS claimed_role VARCHAR(50);`);
    await pool.query(`ALTER TABLE manual_reviews ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE manual_reviews ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE manual_reviews ADD COLUMN IF NOT EXISTS reviewed_role VARCHAR(50);`);
    await pool.query(`ALTER TABLE manual_reviews ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS review_case_events (
        event_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id      UUID NOT NULL REFERENCES manual_reviews(transaction_id) ON DELETE CASCADE,
        event_type          VARCHAR(60) NOT NULL,
        actor               VARCHAR(255),
        actor_role          VARCHAR(50),
        from_status         VARCHAR(50),
        to_status           VARCHAR(50),
        notes               TEXT,
        metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_manual_reviews_queue_status
      ON manual_reviews (queue_status, created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_manual_reviews_customer_id
      ON manual_reviews (customer_id, created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_manual_reviews_claim_owner
      ON manual_reviews (claimed_by, queue_status, claim_expires_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_review_case_events_txn_created
      ON review_case_events (transaction_id, created_at DESC);
    `);

    await pool.query(`ALTER TABLE review_case_events ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50);`);

    logger.info('Manual review schema migration complete');
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

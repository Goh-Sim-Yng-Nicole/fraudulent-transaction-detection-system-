require('dotenv').config();
const { Pool } = require('pg');
const config = require('../config');
const logger = require('../config/logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDatabase = async (pool, attempts = 30, delayMs = 2000) => {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1;');
      return;
    } catch (error) {
      lastError = error;
      logger.warn('Audit database not ready yet, retrying', { attempt, attempts, error: error.message });
      await sleep(delayMs);
    }
  }

  throw lastError || new Error('Audit database did not become ready in time');
};

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
    await waitForDatabase(pool);
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id            BIGSERIAL PRIMARY KEY,
        event_uuid          UUID NOT NULL DEFAULT gen_random_uuid(),

        -- Event metadata
        event_type          VARCHAR(100) NOT NULL,
        event_source        VARCHAR(100) NOT NULL,
        event_timestamp     TIMESTAMPTZ NOT NULL,

        -- Transaction/entity tracking
        transaction_id      UUID,
        customer_id         VARCHAR(255),
        correlation_id      VARCHAR(255),

        -- Kafka metadata
        kafka_topic         VARCHAR(255) NOT NULL,
        kafka_partition     INTEGER NOT NULL,
        kafka_offset        BIGINT NOT NULL,
        kafka_timestamp     TIMESTAMPTZ,

        -- Event payload (full event data)
        event_payload       JSONB NOT NULL,
        event_dedupe_key    VARCHAR(64),

        -- Tamper detection (SHA-256 hash of event_payload + previous_hash)
        event_hash          VARCHAR(64) NOT NULL,
        previous_hash       VARCHAR(64),

        -- Audit metadata
        recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        service_version     VARCHAR(50),

        -- Immutability constraint
        is_deleted          BOOLEAN DEFAULT FALSE,

        -- Ensure unique Kafka events
        CONSTRAINT unique_kafka_event UNIQUE (kafka_topic, kafka_partition, kafka_offset)
      );
    `);
    await pool.query('DROP TRIGGER IF EXISTS prevent_audit_events_modification ON audit_events;');
    await pool.query('ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_dedupe_key VARCHAR(64);');
    await pool.query(`
      UPDATE audit_events
      SET event_dedupe_key = encode(
        digest(
          coalesce(event_type, '') || '|' ||
          coalesce(transaction_id::text, '') || '|' ||
          coalesce(customer_id, '') || '|' ||
          coalesce(correlation_id, '') || '|' ||
          coalesce(event_payload::text, ''),
          'sha256'
        ),
        'hex'
      )
      WHERE event_dedupe_key IS NULL;
    `);
    await pool.query('ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS unique_kafka_event;');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_dedupe_key ON audit_events(event_dedupe_key);');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_snapshots (
        snapshot_id         BIGSERIAL PRIMARY KEY,
        entity_type         VARCHAR(100) NOT NULL,
        entity_id           VARCHAR(255) NOT NULL,

        -- Snapshot data
        snapshot_data       JSONB NOT NULL,
        snapshot_hash       VARCHAR(64) NOT NULL,

        -- Timestamps
        snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valid_from          TIMESTAMPTZ NOT NULL,
        valid_to            TIMESTAMPTZ,

        -- Metadata
        created_by_event_id BIGINT REFERENCES audit_events(event_id),

        CONSTRAINT unique_entity_snapshot UNIQUE (entity_type, entity_id, snapshot_at)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_chain_checkpoints (
        checkpoint_id       BIGSERIAL PRIMARY KEY,

        -- Range of events in this checkpoint
        start_event_id      BIGINT NOT NULL,
        end_event_id        BIGINT NOT NULL,

        -- Aggregate hash (Merkle-tree style)
        aggregate_hash      VARCHAR(64) NOT NULL,
        event_count         INTEGER NOT NULL,

        -- Timestamps
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT valid_event_range CHECK (end_event_id >= start_event_id)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_queries (
        query_id            BIGSERIAL PRIMARY KEY,

        -- Query metadata
        query_type          VARCHAR(100) NOT NULL,
        query_params        JSONB NOT NULL,

        -- Results
        result_count        INTEGER,
        execution_time_ms   INTEGER,

        -- Audit trail for queries (who accessed what)
        queried_by          VARCHAR(255),
        queried_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        query_reason        TEXT
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_events_transaction_id ON audit_events(transaction_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_events_customer_id ON audit_events(customer_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_events_correlation_id ON audit_events(correlation_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events(event_type);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_events_event_timestamp ON audit_events(event_timestamp);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_events_recorded_at ON audit_events(recorded_at);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_events_kafka ON audit_events(kafka_topic, kafka_partition, kafka_offset);');

    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_snapshots_entity ON audit_snapshots(entity_type, entity_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_snapshots_valid_from ON audit_snapshots(valid_from);');

    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_queries_queried_at ON audit_queries(queried_at);');
    await pool.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        IF (TG_OP = 'UPDATE') THEN
          RAISE EXCEPTION 'Audit events are immutable - updates not allowed';
        END IF;
        IF (TG_OP = 'DELETE') THEN
          RAISE EXCEPTION 'Audit events are immutable - deletes not allowed';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS prevent_audit_events_modification ON audit_events;
      CREATE TRIGGER prevent_audit_events_modification
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
    `);

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

const { query, getClient } = require('../db/pool');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../config/logger');

class AuditRepository {

  // Handles store event.
  async storeEvent(eventData) {
    const client = await getClient();
    const eventDedupeKey = this._calculateDedupeKey(eventData);

    try {
      await client.query('BEGIN');
      let previousHash = null;
      if (config.audit.enableChainValidation) {
        const lastEventResult = await client.query(
          'SELECT event_hash FROM audit_events ORDER BY event_id DESC LIMIT 1'
        );
        if (lastEventResult.rows.length > 0) {
          previousHash = lastEventResult.rows[0].event_hash;
        }
      }
      const eventHash = this._calculateHash(eventData.payload, previousHash);
      const sql = `
        INSERT INTO audit_events (
          event_type, event_source, event_timestamp,
          transaction_id, customer_id, correlation_id,
          kafka_topic, kafka_partition, kafka_offset, kafka_timestamp,
          event_payload, event_dedupe_key, event_hash, previous_hash,
          service_version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (event_dedupe_key) DO NOTHING
        RETURNING event_id, event_uuid, recorded_at
      `;

      const values = [
        eventData.eventType,
        eventData.eventSource,
        eventData.eventTimestamp,
        eventData.transactionId,
        eventData.customerId,
        eventData.correlationId,
        eventData.kafkaTopic,
        eventData.kafkaPartition,
        eventData.kafkaOffset,
        eventData.kafkaTimestamp,
        JSON.stringify(eventData.payload),
        eventDedupeKey,
        eventHash,
        previousHash,
        config.serviceVersion,
      ];

      const result = await client.query(sql, values);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        logger.debug('Duplicate event skipped', {
          eventDedupeKey,
          topic: eventData.kafkaTopic,
          partition: eventData.kafkaPartition,
          offset: eventData.kafkaOffset,
        });
        return null;
      }

      const { event_id, event_uuid, recorded_at } = result.rows[0];

      await client.query('COMMIT');

      logger.info('Audit event stored', {
        eventId: event_id,
        eventUuid: event_uuid,
        eventType: eventData.eventType,
        transactionId: eventData.transactionId,
      });

      return {
        eventId: event_id,
        eventUuid: event_uuid,
        eventHash,
        recordedAt: recorded_at,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to store audit event', {
        error: err.message,
        stack: err.stack,
        eventType: eventData.eventType,
      });
      throw err;
    } finally {
      client.release();
    }
  }


  // Handles get audit trail.
  async getAuditTrail(transactionId, options = {}) {
    const { includePayload = true, limit = 100 } = options;

    const selectColumns = includePayload
      ? 'event_id, event_uuid, event_type, event_source, event_timestamp, transaction_id, customer_id, correlation_id, kafka_topic, event_payload, event_hash, recorded_at'
      : 'event_id, event_uuid, event_type, event_source, event_timestamp, transaction_id, customer_id, correlation_id, kafka_topic, event_hash, recorded_at';

    const sql = `
      SELECT ${selectColumns}
      FROM audit_events
      WHERE transaction_id = $1
      ORDER BY event_timestamp ASC, event_id ASC
      LIMIT $2
    `;

    const result = await query(sql, [transactionId, limit]);

    return result.rows.map(row => ({
      eventId: row.event_id,
      eventUuid: row.event_uuid,
      eventType: row.event_type,
      eventSource: row.event_source,
      eventTimestamp: row.event_timestamp,
      transactionId: row.transaction_id,
      customerId: row.customer_id,
      correlationId: row.correlation_id,
      kafkaTopic: row.kafka_topic,
      eventPayload: includePayload ? row.event_payload : null,
      eventHash: row.event_hash,
      recordedAt: row.recorded_at,
    }));
  }


  // Handles get customer audit trail.
  async getCustomerAuditTrail(customerId, options = {}) {
    const { since, until, eventTypes, limit = 100 } = options;

    let sql = `
      SELECT event_id, event_uuid, event_type, event_source, event_timestamp,
             transaction_id, customer_id, correlation_id, kafka_topic,
             event_hash, recorded_at
      FROM audit_events
      WHERE customer_id = $1
    `;

    const params = [customerId];
    let paramIndex = 2;

    if (since) {
      sql += ` AND event_timestamp >= $${paramIndex}`;
      params.push(since);
      paramIndex++;
    }

    if (until) {
      sql += ` AND event_timestamp <= $${paramIndex}`;
      params.push(until);
      paramIndex++;
    }

    if (eventTypes && eventTypes.length > 0) {
      sql += ` AND event_type = ANY($${paramIndex})`;
      params.push(eventTypes);
      paramIndex++;
    }

    sql += ` ORDER BY event_timestamp DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows;
  }


  // Handles verify chain integrity.
  async verifyChainIntegrity(startEventId, endEventId) {
    const sql = `
      SELECT event_id, event_payload, event_hash, previous_hash
      FROM audit_events
      WHERE event_id >= $1 AND event_id <= $2
      ORDER BY event_id ASC
    `;

    const result = await query(sql, [startEventId, endEventId]);
    const events = result.rows;

    const issues = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const expectedHash = this._calculateHash(
        event.event_payload,
        event.previous_hash
      );

      if (event.event_hash !== expectedHash) {
        issues.push({
          eventId: event.event_id,
          issue: 'hash_mismatch',
          expected: expectedHash,
          actual: event.event_hash,
        });
      }

      if (i > 0) {
        const prevEvent = events[i - 1];
        if (event.previous_hash !== prevEvent.event_hash) {
          issues.push({
            eventId: event.event_id,
            issue: 'chain_broken',
            expected: prevEvent.event_hash,
            actual: event.previous_hash,
          });
        }
      }
    }

    return {
      verified: issues.length === 0,
      totalEvents: events.length,
      issues,
    };
  }


  // Handles get stats.
  async getStats(since) {
    const sql = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT transaction_id) as unique_transactions,
        COUNT(DISTINCT customer_id) as unique_customers,
        COUNT(DISTINCT event_type) as unique_event_types,
        MIN(event_timestamp) as earliest_event,
        MAX(event_timestamp) as latest_event
      FROM audit_events
      WHERE event_timestamp >= $1
    `;

    const result = await query(sql, [since]);
    return result.rows[0];
  }


  // Handles log query.
  async logQuery(queryType, queryParams, resultCount, executionTimeMs, queriedBy, reason) {
    const sql = `
      INSERT INTO audit_queries (
        query_type, query_params, result_count, execution_time_ms,
        queried_by, query_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING query_id
    `;

    const result = await query(sql, [
      queryType,
      JSON.stringify(queryParams),
      resultCount,
      executionTimeMs,
      queriedBy,
      reason,
    ]);

    return result.rows[0].query_id;
  }

  // Handles calculate hash.
  _calculateHash(payload, previousHash) {
    const data = JSON.stringify(payload) + (previousHash || '');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  _calculateDedupeKey(eventData) {
    const payload = JSON.stringify(eventData.payload ?? {});
    const identity = [
      eventData.eventType || '',
      eventData.transactionId || '',
      eventData.customerId || '',
      eventData.correlationId || '',
      payload,
    ].join('|');

    return crypto.createHash('sha256').update(identity).digest('hex');
  }
}

module.exports = new AuditRepository();

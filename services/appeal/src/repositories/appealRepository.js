const { getPool, query } = require('../db/pool');

class AppealRepository {
  async _insertEvent(client, appealId, eventType, actor, actorRole, fromStatus, toStatus, notes, metadata = {}) {
    await client.query(`
      INSERT INTO appeal_case_events (
        appeal_id, event_type, actor, actor_role, from_status, to_status, notes, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `, [
      appealId,
      eventType,
      actor || null,
      actorRole || null,
      fromStatus || null,
      toStatus || null,
      notes || null,
      JSON.stringify(metadata || {}),
    ]);
  }

  // Handles create appeal.
  async createAppeal({
    transactionId,
    customerId,
    sourceTransactionStatus,
    appealReason,
    evidence,
    correlationId,
  }) {
    const sql = `
      INSERT INTO appeals (
        transaction_id,
        customer_id,
        source_transaction_status,
        current_status,
        appeal_reason,
        evidence,
        correlation_id,
        version
      )
      VALUES ($1, $2, $3, 'OPEN', $4, $5::jsonb, $6, 0)
      RETURNING *;
    `;

    const values = [
      transactionId,
      customerId,
      sourceTransactionStatus,
      appealReason,
      JSON.stringify(evidence || {}),
      correlationId || null,
    ];

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows } = await client.query(sql, values);
      await this._insertEvent(
        client,
        rows[0].appeal_id,
        'APPEAL_CREATED',
        'customer',
        'customer',
        null,
        'OPEN',
        appealReason,
        { transactionId, customerId }
      );
      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Handles get by appeal id.
  async getByAppealId(appealId) {
    const { rows } = await query(`
      SELECT *
      FROM appeals
      WHERE appeal_id = $1;
    `, [appealId]);

    return rows[0] ? this._map(rows[0]) : null;
  }

  // Handles get active by transaction.
  async getActiveByTransaction(transactionId) {
    const { rows } = await query(`
      SELECT *
      FROM appeals
      WHERE transaction_id = $1
        AND current_status IN ('OPEN', 'UNDER_REVIEW')
      ORDER BY created_at DESC
      LIMIT 1;
    `, [transactionId]);

    return rows[0] ? this._map(rows[0]) : null;
  }

  // Handles get latest by transaction regardless of status.
  async getAnyByTransaction(transactionId) {
    const { rows } = await query(`
      SELECT *
      FROM appeals
      WHERE transaction_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `, [transactionId]);

    return rows[0] ? this._map(rows[0]) : null;
  }

  // Handles list pending.
  async listPending(limit = 20, offset = 0, assignee = null) {
    const params = [];
    const clauses = [`current_status IN ('OPEN', 'UNDER_REVIEW')`];

    if (assignee) {
      params.push(assignee);
      clauses.push(`claimed_by = $${params.length}`);
    }

    params.push(limit, offset);
    const { rows } = await query(`
      SELECT *
      FROM appeals
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `, params);

    return rows.map((row) => this._map(row));
  }

  // Handles list by customer.
  async listByCustomer(customerId, limit = 20, offset = 0) {
    const { rows } = await query(`
      SELECT *
      FROM appeals
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `, [customerId, limit, offset]);

    return rows.map((row) => this._map(row));
  }

  // Handles resolve appeal.
  async claimAppeal(appealId, reviewerId, reviewerRole, claimTtlMinutes = 10) {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(`
        SELECT *
        FROM appeals
        WHERE appeal_id = $1
        FOR UPDATE;
      `, [appealId]);

      if (!existingRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingRows[0];
      const now = new Date();
      const isExpired = !existing.claim_expires_at || new Date(existing.claim_expires_at) <= now;

      if (existing.current_status === 'RESOLVED') {
        await client.query('ROLLBACK');
        return { conflict: 'APPEAL_ALREADY_RESOLVED' };
      }

      if (existing.current_status === 'UNDER_REVIEW' && existing.claimed_by && existing.claimed_by !== reviewerId && !isExpired) {
        await client.query('ROLLBACK');
        return { conflict: 'APPEAL_ALREADY_CLAIMED', claimedBy: existing.claimed_by, claimExpiresAt: existing.claim_expires_at };
      }

      const { rows } = await client.query(`
        UPDATE appeals
        SET
          current_status = 'UNDER_REVIEW',
          claimed_by = $2,
          claimed_role = $3,
          claimed_at = NOW(),
          claim_expires_at = NOW() + ($4::text || ' minutes')::interval,
          updated_at = NOW(),
          version = version + 1
        WHERE appeal_id = $1
        RETURNING *;
      `, [appealId, reviewerId, reviewerRole || null, String(claimTtlMinutes)]);

      await this._insertEvent(
        client,
        appealId,
        'APPEAL_CLAIMED',
        reviewerId,
        reviewerRole,
        existing.current_status,
        'UNDER_REVIEW',
        `Appeal claimed for ${claimTtlMinutes} minutes`,
        { claimTtlMinutes }
      );

      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseAppeal(appealId, reviewerId, reviewerRole, notes) {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(`
        SELECT *
        FROM appeals
        WHERE appeal_id = $1
        FOR UPDATE;
      `, [appealId]);

      if (!existingRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingRows[0];
      if (existing.current_status === 'RESOLVED') {
        await client.query('ROLLBACK');
        return { conflict: 'APPEAL_ALREADY_RESOLVED' };
      }

      if (existing.claimed_by !== reviewerId) {
        await client.query('ROLLBACK');
        return { conflict: 'APPEAL_NOT_CLAIMED_BY_REVIEWER', claimedBy: existing.claimed_by };
      }

      const { rows } = await client.query(`
        UPDATE appeals
        SET
          current_status = 'OPEN',
          claimed_by = NULL,
          claimed_role = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          updated_at = NOW(),
          version = version + 1
        WHERE appeal_id = $1
        RETURNING *;
      `, [appealId]);

      await this._insertEvent(
        client,
        appealId,
        'APPEAL_RELEASED',
        reviewerId,
        reviewerRole,
        'UNDER_REVIEW',
        'OPEN',
        notes || 'Appeal released',
        {}
      );

      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveAppeal(appealId, { resolution, reviewedBy, reviewedRole, resolutionNotes }) {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(`
        SELECT *
        FROM appeals
        WHERE appeal_id = $1
        FOR UPDATE;
      `, [appealId]);

      if (!existingRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingRows[0];
      if (existing.current_status === 'RESOLVED') {
        await client.query('ROLLBACK');
        return { conflict: 'APPEAL_ALREADY_RESOLVED', reviewedBy: existing.reviewed_by };
      }

      if (existing.current_status !== 'UNDER_REVIEW' || existing.claimed_by !== reviewedBy) {
        await client.query('ROLLBACK');
        return { conflict: 'APPEAL_NOT_CLAIMED_BY_REVIEWER', claimedBy: existing.claimed_by };
      }

      const { rows } = await client.query(`
        UPDATE appeals
        SET
          current_status = 'RESOLVED',
          resolution = $2,
          reviewed_by = $3,
          resolved_role = $4,
          resolution_notes = $5,
          resolved_at = NOW(),
          claimed_by = NULL,
          claimed_role = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          updated_at = NOW(),
          version = version + 1
        WHERE appeal_id = $1
        RETURNING *;
      `, [appealId, resolution, reviewedBy, reviewedRole || null, resolutionNotes || null]);

      await this._insertEvent(
        client,
        appealId,
        'APPEAL_RESOLVED',
        reviewedBy,
        reviewedRole,
        existing.current_status,
        'RESOLVED',
        resolutionNotes,
        { resolution }
      );

      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Handles map.
  _map(row) {
    return {
      appealId: row.appeal_id,
      transactionId: row.transaction_id,
      customerId: row.customer_id,
      sourceTransactionStatus: row.source_transaction_status,
      currentStatus: row.current_status,
      resolution: row.resolution,
      appealReason: row.appeal_reason,
      evidence: row.evidence,
      resolutionNotes: row.resolution_notes,
      reviewedBy: row.reviewed_by,
      resolvedRole: row.resolved_role,
      claimedBy: row.claimed_by,
      claimedRole: row.claimed_role,
      claimedAt: row.claimed_at,
      claimExpiresAt: row.claim_expires_at,
      correlationId: row.correlation_id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    };
  }
}

module.exports = new AppealRepository();

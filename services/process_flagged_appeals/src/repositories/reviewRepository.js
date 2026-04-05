const { getPool, query } = require('../db/pool');

class ReviewRepository {
  async _insertEvent(client, transactionId, eventType, actor, actorRole, fromStatus, toStatus, notes, metadata = {}) {
    await client.query(`
      INSERT INTO review_case_events (
        transaction_id, event_type, actor, actor_role, from_status, to_status, notes, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `, [
      transactionId,
      eventType,
      actor || null,
      actorRole || null,
      fromStatus || null,
      toStatus || null,
      notes || null,
      JSON.stringify(metadata || {}),
    ]);
  }

  // Handles upsert from flagged event.
  async upsertFromFlagged(event, sourceTopic = 'transaction.flagged') {
    const transactionId = event.transactionId;
    const customerId = event.customerId || event.originalTransaction?.customerId;
    const merchantId = event.merchantId || event.originalTransaction?.merchantId || null;
    const riskScore = event.fraudAnalysis?.riskScore ?? null;
    const decisionReason = event.decisionReason || 'Flagged for manual review';
    const correlationId = event.correlationId || null;

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        INSERT INTO manual_reviews (
          transaction_id, customer_id, merchant_id, source_topic,
          previous_decision, decision_reason, risk_score, payload, correlation_id,
          queue_status, final_decision, reviewed_by, reviewed_role, review_notes,
          claimed_by, claimed_role, claimed_at, claim_expires_at, reviewed_at, updated_at, version
        ) VALUES (
          $1, $2, $3, $4,
          'FLAGGED', $5, $6, $7::jsonb, $8,
          'PENDING', NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, NOW(), 0
        )
        ON CONFLICT (transaction_id) DO UPDATE SET
          decision_reason = EXCLUDED.decision_reason,
          risk_score = EXCLUDED.risk_score,
          payload = EXCLUDED.payload,
          correlation_id = EXCLUDED.correlation_id,
          queue_status = 'PENDING',
          final_decision = NULL,
          reviewed_by = NULL,
          reviewed_role = NULL,
          review_notes = NULL,
          claimed_by = NULL,
          claimed_role = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          reviewed_at = NULL,
          updated_at = NOW(),
          version = manual_reviews.version + 1
        RETURNING *;
      `, [
        transactionId,
        customerId,
        merchantId,
        sourceTopic,
        decisionReason,
        riskScore,
        JSON.stringify(event || {}),
        correlationId,
      ]);

      await this._insertEvent(
        client,
        transactionId,
        'CASE_ENQUEUED',
        'system',
        'system',
        null,
        'PENDING',
        decisionReason,
        { sourceTopic }
      );

      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listCases({ statuses = ['PENDING', 'IN_REVIEW'], assignee, limit = 20, offset = 0 }) {
    const clauses = [];
    const values = [];

    if (statuses.length) {
      values.push(statuses);
      clauses.push(`queue_status = ANY($${values.length}::text[])`);
    }

    if (assignee) {
      values.push(assignee);
      clauses.push(`claimed_by = $${values.length}`);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(limit);
    values.push(offset);

    const { rows } = await query(`
      SELECT *
      FROM manual_reviews
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length};
    `, values);

    return rows.map((row) => this._map(row));
  }

  // Backward-compatible existing endpoint.
  async listPending(limit = 20, offset = 0) {
    return this.listCases({ statuses: ['PENDING', 'IN_REVIEW'], limit, offset });
  }

  async getByTransactionId(transactionId) {
    const { rows } = await query(`
      SELECT *
      FROM manual_reviews
      WHERE transaction_id = $1;
    `, [transactionId]);
    return rows[0] ? this._map(rows[0]) : null;
  }

  async getHistory(transactionId, limit = 50) {
    const { rows } = await query(`
      SELECT event_id, transaction_id, event_type, actor, actor_role, from_status, to_status, notes, metadata, created_at
      FROM review_case_events
      WHERE transaction_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `, [transactionId, limit]);

    return rows.map((row) => ({
      eventId: row.event_id,
      transactionId: row.transaction_id,
      eventType: row.event_type,
      actor: row.actor,
      actorRole: row.actor_role,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      notes: row.notes,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }

  async claimCase(transactionId, reviewerId, reviewerRole, claimTtlMinutes = 10) {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(`
        SELECT *
        FROM manual_reviews
        WHERE transaction_id = $1
        FOR UPDATE;
      `, [transactionId]);

      if (!existingRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingRows[0];
      const now = new Date();
      const isExpired = !existing.claim_expires_at || new Date(existing.claim_expires_at) <= now;

      if (existing.queue_status === 'REVIEWED') {
        await client.query('ROLLBACK');
        return { conflict: 'CASE_ALREADY_REVIEWED' };
      }

      if (existing.queue_status === 'IN_REVIEW' && existing.claimed_by && existing.claimed_by !== reviewerId && !isExpired) {
        await client.query('ROLLBACK');
        return { conflict: 'CASE_ALREADY_CLAIMED', claimedBy: existing.claimed_by, claimExpiresAt: existing.claim_expires_at };
      }

      const { rows } = await client.query(`
        UPDATE manual_reviews
        SET
          queue_status = 'IN_REVIEW',
          claimed_by = $2,
          claimed_role = $3,
          claimed_at = NOW(),
          claim_expires_at = NOW() + ($4::text || ' minutes')::interval,
          updated_at = NOW(),
          version = version + 1
        WHERE transaction_id = $1
        RETURNING *;
      `, [transactionId, reviewerId, reviewerRole || null, String(claimTtlMinutes)]);

      await this._insertEvent(
        client,
        transactionId,
        'CASE_CLAIMED',
        reviewerId,
        reviewerRole,
        existing.queue_status,
        'IN_REVIEW',
        `Case claimed for ${claimTtlMinutes} minutes`,
        { claimTtlMinutes }
      );

      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async releaseCase(transactionId, reviewerId, reviewerRole, notes) {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(`
        SELECT *
        FROM manual_reviews
        WHERE transaction_id = $1
        FOR UPDATE;
      `, [transactionId]);

      if (!existingRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingRows[0];
      if (existing.queue_status === 'REVIEWED') {
        await client.query('ROLLBACK');
        return { conflict: 'CASE_ALREADY_REVIEWED' };
      }

      if (existing.claimed_by !== reviewerId) {
        await client.query('ROLLBACK');
        return { conflict: 'CASE_NOT_CLAIMED_BY_REVIEWER', claimedBy: existing.claimed_by };
      }

      const { rows } = await client.query(`
        UPDATE manual_reviews
        SET
          queue_status = 'PENDING',
          claimed_by = NULL,
          claimed_role = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          updated_at = NOW(),
          version = version + 1
        WHERE transaction_id = $1
        RETURNING *;
      `, [transactionId]);

      await this._insertEvent(client, transactionId, 'CASE_RELEASED', reviewerId, reviewerRole, 'IN_REVIEW', 'PENDING', notes || 'Case released', {});

      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async applyReviewDecision(transactionId, decision, reviewedBy, reviewedRole, reviewNotes) {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(`
        SELECT *
        FROM manual_reviews
        WHERE transaction_id = $1
        FOR UPDATE;
      `, [transactionId]);

      if (!existingRows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingRows[0];
      if (existing.queue_status === 'REVIEWED') {
        await client.query('ROLLBACK');
        return { conflict: 'CASE_ALREADY_REVIEWED', reviewedBy: existing.reviewed_by };
      }

      if (existing.queue_status !== 'IN_REVIEW' || existing.claimed_by !== reviewedBy) {
        await client.query('ROLLBACK');
        return { conflict: 'CASE_NOT_CLAIMED_BY_REVIEWER', claimedBy: existing.claimed_by };
      }

      const { rows } = await client.query(`
        UPDATE manual_reviews
        SET
          queue_status = 'REVIEWED',
          final_decision = $2,
          reviewed_by = $3,
          reviewed_role = $4,
          review_notes = $5,
          reviewed_at = NOW(),
          claimed_by = NULL,
          claimed_role = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          updated_at = NOW(),
          version = version + 1
        WHERE transaction_id = $1
        RETURNING *;
      `, [transactionId, decision, reviewedBy, reviewedRole || null, reviewNotes || null]);

      await this._insertEvent(
        client,
        transactionId,
        'CASE_RESOLVED',
        reviewedBy,
        reviewedRole,
        existing.queue_status,
        'REVIEWED',
        reviewNotes,
        { decision }
      );

      await client.query('COMMIT');
      return this._map(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  _map(row) {
    const payload = row.payload || {};
    const originalTransaction = payload.originalTransaction || {};
    const fraudAnalysis = payload.fraudAnalysis || {};
    const ruleResults = fraudAnalysis.ruleResults || {};
    const mlResults = fraudAnalysis.mlResults || {};
    const decisionFactors = payload.decisionFactors || {};
    const analysisReasons = Array.isArray(fraudAnalysis.reasons) ? fraudAnalysis.reasons : [];
    const ruleReasons = Array.isArray(ruleResults.reasons) ? ruleResults.reasons : [];
    const reasonHighlights = [...new Set([...analysisReasons, ...ruleReasons].filter(Boolean))];

    return {
      reviewId: row.review_id,
      transactionId: row.transaction_id,
      customerId: row.customer_id,
      merchantId: row.merchant_id,
      queueStatus: row.queue_status,
      previousDecision: row.previous_decision,
      finalDecision: row.final_decision,
      decisionReason: row.decision_reason,
      riskScore: row.risk_score === null ? null : parseFloat(row.risk_score),
      payload,
      originalTransaction,
      fraudAnalysis,
      decisionFactors,
      amount: originalTransaction.amount ?? null,
      currency: originalTransaction.currency || null,
      cardType: originalTransaction.cardType || null,
      transactionCountry: originalTransaction.location?.country || null,
      transactionCreatedAt: originalTransaction.createdAt || null,
      reasonHighlights,
      ruleReasons,
      analysisReasons,
      adjustedScore: decisionFactors.adjustedScore ?? fraudAnalysis.riskScore ?? row.risk_score,
      originalScore: decisionFactors.originalScore ?? fraudAnalysis.riskScore ?? row.risk_score,
      mlScore: mlResults.score ?? null,
      mlConfidence: mlResults.confidence ?? null,
      modelVersion: mlResults.modelVersion || mlResults.model_version || null,
      overrideReason: payload.overrideReason || null,
      overrideType: payload.overrideType || null,
      reviewedBy: row.reviewed_by,
      reviewedRole: row.reviewed_role,
      reviewNotes: row.review_notes,
      claimedBy: row.claimed_by,
      claimedRole: row.claimed_role,
      claimedAt: row.claimed_at,
      claimExpiresAt: row.claim_expires_at,
      correlationId: row.correlation_id,
      version: row.version,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = new ReviewRepository();

const { query } = require('../db/pool');

class AppealRepository {
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
        correlation_id
      )
      VALUES ($1, $2, $3, 'OPEN', $4, $5::jsonb, $6)
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

    const { rows } = await query(sql, values);
    return this._map(rows[0]);
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
  async listPending(limit = 20, offset = 0) {
    const { rows } = await query(`
      SELECT *
      FROM appeals
      WHERE current_status IN ('OPEN', 'UNDER_REVIEW')
      ORDER BY created_at ASC
      LIMIT $1 OFFSET $2;
    `, [limit, offset]);

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
  async resolveAppeal(appealId, { resolution, reviewedBy, resolutionNotes }) {
    const { rows } = await query(`
      UPDATE appeals
      SET
        current_status = 'RESOLVED',
        resolution = $2,
        reviewed_by = $3,
        resolution_notes = $4,
        resolved_at = NOW(),
        updated_at = NOW()
      WHERE appeal_id = $1
        AND current_status IN ('OPEN', 'UNDER_REVIEW')
      RETURNING *;
    `, [appealId, resolution, reviewedBy, resolutionNotes || null]);

    return rows[0] ? this._map(rows[0]) : null;
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
      correlationId: row.correlation_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    };
  }
}

module.exports = new AppealRepository();

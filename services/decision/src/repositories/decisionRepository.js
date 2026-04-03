const { query, getClient } = require('../db/pool');
const logger = require('../config/logger');

class DecisionRepository {
  _mapAppealResolutionToDecision(resolution) {
    const normalized = String(resolution || '').toUpperCase();
    if (normalized === 'REVERSE') {
      return 'APPROVED';
    }
    if (normalized === 'UPHOLD') {
      return 'DECLINED';
    }
    return null;
  }
  
  // Handles save decision.
  async saveDecision(decisionData) {
    const client = await getClient();

    try {
      await client.query('BEGIN');
      const decisionSql = `
        INSERT INTO decisions (
          transaction_id, customer_id, merchant_id,
          risk_score, ml_score, rule_score, fraud_flagged, confidence,
          decision, decision_reason, decision_factors,
          override_applied, override_reason, override_type,
          correlation_id, decision_version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (transaction_id) DO UPDATE SET
          decision = EXCLUDED.decision,
          decision_reason = EXCLUDED.decision_reason,
          decided_at = NOW()
        RETURNING decision_id, decided_at
      `;

      const decisionValues = [
        decisionData.transactionId,
        decisionData.customerId,
        decisionData.merchantId,
        decisionData.riskScore,
        decisionData.mlScore,
        decisionData.ruleScore,
        decisionData.fraudFlagged,
        decisionData.confidence,
        decisionData.decision,
        decisionData.decisionReason,
        JSON.stringify(decisionData.decisionFactors),
        decisionData.overrideApplied || false,
        decisionData.overrideReason || null,
        decisionData.overrideType || null,
        decisionData.correlationId,
        decisionData.decisionVersion,
      ];

      const decisionResult = await client.query(decisionSql, decisionValues);
      const { decision_id, decided_at } = decisionResult.rows[0];
      const historySql = `
        INSERT INTO decision_history (
          decision_id, transaction_id,
          fraud_analysis, original_transaction,
          decision, decision_metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING history_id
      `;

      const historyValues = [
        decision_id,
        decisionData.transactionId,
        JSON.stringify(decisionData.fraudAnalysis),
        JSON.stringify(decisionData.originalTransaction),
        decisionData.decision,
        JSON.stringify(decisionData.decisionMetadata || {}),
      ];

      await client.query(historySql, historyValues);

      await client.query('COMMIT');

      logger.info('Decision saved', {
        decisionId: decision_id,
        transactionId: decisionData.transactionId,
        decision: decisionData.decision,
      });

      return { decisionId: decision_id, decidedAt: decided_at };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to save decision', { error: err.message, stack: err.stack });
      throw err;
    } finally {
      client.release();
    }
  }

  
  // Handles find by transaction id.
  async findByTransactionId(transactionId) {
    const sql = `
      SELECT 
        decision_id, transaction_id, customer_id, merchant_id,
        risk_score, ml_score, rule_score, fraud_flagged, confidence,
        decision, decision_reason, decision_factors,
        override_applied, override_reason, override_type,
        decided_at, correlation_id, decision_version
      FROM decisions
      WHERE transaction_id = $1
    `;

    const result = await query(sql, [transactionId]);
    return result.rows[0] || null;
  }

  // Handles apply manual review decision.
  async applyManualReviewDecision({
    transactionId,
    decision,
    correlationId,
    reviewedBy,
    reviewNotes,
    reviewedAt,
    rawEvent,
  }) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const existingDecisionRes = await client.query(`
        SELECT decision_id, decision
        FROM decisions
        WHERE transaction_id = $1
        FOR UPDATE
      `, [transactionId]);

      if (existingDecisionRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingDecisionRes.rows[0];

      const decisionFactorsPatch = {
        manualReviewApplied: true,
        manualReview: {
          reviewedBy: reviewedBy || null,
          reviewNotes: reviewNotes || null,
          reviewedAt: reviewedAt || new Date().toISOString(),
          sourceEventType: 'transaction.reviewed',
        },
      };

      const decisionReason = `Manual review final decision: ${decision}`;
      const updateRes = await client.query(`
        UPDATE decisions
        SET
          decision = $2,
          decision_reason = $3,
          decision_factors = COALESCE(decision_factors, '{}'::jsonb) || $4::jsonb,
          override_applied = TRUE,
          override_reason = 'Manual review decision',
          override_type = 'MANUAL_REVIEW',
          decided_at = NOW(),
          correlation_id = COALESCE($5, correlation_id),
          decision_version = '1.0.0-manual-review'
        WHERE transaction_id = $1
        RETURNING decision_id, decided_at
      `, [
        transactionId,
        decision,
        decisionReason,
        JSON.stringify(decisionFactorsPatch),
        correlationId || null,
      ]);

      const latestHistoryRes = await client.query(`
        SELECT fraud_analysis, original_transaction
        FROM decision_history
        WHERE transaction_id = $1
        ORDER BY recorded_at DESC
        LIMIT 1
      `, [transactionId]);

      const latestHistory = latestHistoryRes.rows[0] || {};

      await client.query(`
        INSERT INTO decision_history (
          decision_id, transaction_id,
          fraud_analysis, original_transaction,
          decision, decision_metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        updateRes.rows[0].decision_id,
        transactionId,
        JSON.stringify(latestHistory.fraud_analysis || {}),
        JSON.stringify(latestHistory.original_transaction || {}),
        decision,
        JSON.stringify({
          source: 'manual_review',
          previousDecision: existing.decision,
          reviewedBy: reviewedBy || null,
          reviewNotes: reviewNotes || null,
          reviewedAt: reviewedAt || new Date().toISOString(),
          correlationId: correlationId || null,
          eventType: 'transaction.reviewed',
          rawEvent: rawEvent || null,
        }),
      ]);

      await client.query('COMMIT');

      return {
        decisionId: updateRes.rows[0].decision_id,
        decidedAt: updateRes.rows[0].decided_at,
        previousDecision: existing.decision,
        decision,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to apply manual review decision', {
        transactionId,
        decision,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    } finally {
      client.release();
    }
  }

  // Handles apply appeal resolution.
  async applyAppealResolution({
    transactionId,
    resolution,
    correlationId,
    reviewedBy,
    resolutionNotes,
    resolvedAt,
    rawEvent,
  }) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const existingDecisionRes = await client.query(`
        SELECT decision_id, decision
        FROM decisions
        WHERE transaction_id = $1
        FOR UPDATE
      `, [transactionId]);

      if (existingDecisionRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const existing = existingDecisionRes.rows[0];
      const finalDecision = this._mapAppealResolutionToDecision(resolution);
      if (!finalDecision) {
        await client.query('ROLLBACK');
        return null;
      }

      const resolvedDecisionAt = resolvedAt || new Date().toISOString();
      const decisionFactorsPatch = {
        appealResolutionApplied: true,
        appealResolution: {
          resolution,
          finalDecision,
          reviewedBy: reviewedBy || null,
          resolutionNotes: resolutionNotes || null,
          resolvedAt: resolvedDecisionAt,
          sourceEventType: 'appeal.resolved',
        },
      };

      const decisionReason = `Appeal resolved: ${resolution}`;
      const updateRes = await client.query(`
        UPDATE decisions
        SET
          decision = $2,
          decision_reason = $3,
          decision_factors = COALESCE(decision_factors, '{}'::jsonb) || $4::jsonb,
          override_applied = TRUE,
          override_reason = $5,
          override_type = 'APPEAL',
          decided_at = NOW(),
          correlation_id = COALESCE($6, correlation_id),
          decision_version = '1.0.0-appeal-resolution'
        WHERE transaction_id = $1
        RETURNING decision_id, decided_at
      `, [
        transactionId,
        finalDecision,
        decisionReason,
        JSON.stringify(decisionFactorsPatch),
        `Appeal resolution: ${resolution}`,
        correlationId || null,
      ]);

      const latestHistoryRes = await client.query(`
        SELECT fraud_analysis, original_transaction
        FROM decision_history
        WHERE transaction_id = $1
        ORDER BY recorded_at DESC
        LIMIT 1
      `, [transactionId]);

      const latestHistory = latestHistoryRes.rows[0] || {};

      await client.query(`
        INSERT INTO decision_history (
          decision_id, transaction_id,
          fraud_analysis, original_transaction,
          decision, decision_metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        updateRes.rows[0].decision_id,
        transactionId,
        JSON.stringify(latestHistory.fraud_analysis || {}),
        JSON.stringify(latestHistory.original_transaction || {}),
        finalDecision,
        JSON.stringify({
          source: 'appeal_resolution',
          previousDecision: existing.decision,
          resolution,
          reviewedBy: reviewedBy || null,
          resolutionNotes: resolutionNotes || null,
          resolvedAt: resolvedDecisionAt,
          correlationId: correlationId || null,
          eventType: 'appeal.resolved',
          rawEvent: rawEvent || null,
        }),
      ]);

      await client.query('COMMIT');

      return {
        decisionId: updateRes.rows[0].decision_id,
        decidedAt: updateRes.rows[0].decided_at,
        previousDecision: existing.decision,
        decision: finalDecision,
        resolution,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to apply appeal resolution', {
        transactionId,
        resolution,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    } finally {
      client.release();
    }
  }

  
  // Handles get stats.
  async getStats(since) {
    const sql = `
      SELECT 
        decision,
        COUNT(*) as count,
        AVG(risk_score) as avg_risk_score,
        MIN(decided_at) as earliest,
        MAX(decided_at) as latest
      FROM decisions
      WHERE decided_at >= $1
      GROUP BY decision
    `;

    const result = await query(sql, [since]);
    return result.rows;
  }
}

module.exports = new DecisionRepository();

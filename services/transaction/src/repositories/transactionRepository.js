const { query } = require('../db/pool');
const { DatabaseError } = require('../utils/errors');

const mapRow = (row, direction = null) => ({
  transaction_id: row.id,
  amount: Number(row.amount),
  currency: row.currency,
  card_type: row.card_type,
  country: row.country,
  merchant_id: row.merchant_id,
  hour_utc: row.hour_utc,
  customer_id: row.customer_id,
  sender_name: row.sender_name,
  recipient_customer_id: row.recipient_customer_id,
  recipient_name: row.recipient_name,
  status: row.status,
  fraud_score: row.fraud_score,
  outcome_reason: row.outcome_reason,
  created_at: row.created_at,
  updated_at: row.updated_at,
  direction
});

class TransactionRepository {
  async findById(transactionId) {
    try {
      const { rows } = await query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) {
      throw new DatabaseError(`Failed to fetch transaction: ${error.message}`);
    }
  }

  async findByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;

    try {
      const { rows } = await query('SELECT * FROM transactions WHERE idempotency_key = $1', [idempotencyKey]);
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) {
      throw new DatabaseError(`Failed idempotency lookup: ${error.message}`);
    }
  }

  async create(record) {
    try {
      const { rows } = await query(
        `INSERT INTO transactions (
          customer_id, sender_name, recipient_customer_id, recipient_name,
          merchant_id, amount, currency, card_type, country, hour_utc,
          status, fraud_score, outcome_reason, idempotency_key, correlation_id, request_id
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16
        )
        RETURNING *`,
        [
          record.customerId,
          record.senderName,
          record.recipientCustomerId,
          record.recipientName,
          record.merchantId,
          record.amount,
          record.currency,
          record.cardType,
          record.country,
          record.hourUtc,
          record.status,
          record.fraudScore,
          record.outcomeReason,
          record.idempotencyKey,
          record.correlationId,
          record.requestId
        ]
      );

      return mapRow(rows[0]);
    } catch (error) {
      throw new DatabaseError(`Failed to create transaction: ${error.message}`);
    }
  }

  async listByCustomer(customerId, direction = 'all') {
    try {
      const records = [];

      if (direction === 'all' || direction === 'outgoing') {
        const { rows } = await query(
          'SELECT * FROM transactions WHERE customer_id = $1 ORDER BY created_at DESC',
          [customerId]
        );
        records.push(...rows.map((row) => mapRow(row, 'OUTGOING')));
      }

      if (direction === 'all' || direction === 'incoming') {
        const { rows } = await query(
          `SELECT * FROM transactions
           WHERE recipient_customer_id = $1 AND status = 'APPROVED'
           ORDER BY created_at DESC`,
          [customerId]
        );
        records.push(...rows.map((row) => mapRow(row, 'INCOMING')));
      }

      if (direction === 'all') {
        records.sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
      }

      return records;
    } catch (error) {
      throw new DatabaseError(`Failed to list transactions: ${error.message}`);
    }
  }

  async applyStatusUpdate({ transactionId, status, fraudScore = null, outcomeReason = null }) {
    try {
      const { rows } = await query(
        `UPDATE transactions
         SET status = $2,
             fraud_score = COALESCE($3, fraud_score),
             outcome_reason = COALESCE($4, outcome_reason)
         WHERE id = $1
         RETURNING *`,
        [transactionId, status, fraudScore, outcomeReason]
      );
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) {
      throw new DatabaseError(`Failed to update transaction status: ${error.message}`);
    }
  }
}

module.exports = new TransactionRepository();

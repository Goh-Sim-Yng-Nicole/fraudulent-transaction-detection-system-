const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../config/logger');
const { publish } = require('../config/kafka');
const appealRepository = require('../repositories/appealRepository');
const { getPool } = require('../db/pool');

class AppealService {
  constructor() {
    this.producer = null;
  }

  // Handles producer binding.
  setProducer(producer) {
    this.producer = producer;
  }

  // Handles create appeal.
  async createAppeal({
    transactionId,
    customerId,
    appealReason,
    evidence,
    correlationId,
  }) {
    if (!transactionId || !customerId) {
      throw new Error('transactionId and customerId are required');
    }

    if (!appealReason || String(appealReason).trim().length < 10) {
      throw new Error('appealReason must be at least 10 characters');
    }

    const existing = await appealRepository.getAnyByTransaction(transactionId);
    if (existing) {
      throw new Error(`Transaction ${transactionId} has already been appealed`);
    }

    const transaction = await this._fetchTransaction(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    const transactionCustomerId = transaction.customerId || transaction.customer_id;
    if (String(transactionCustomerId) !== String(customerId)) {
      throw new Error('Transaction does not belong to this customer');
    }

    const sourceStatus = String(transaction.status || '').toUpperCase();
    if (!['REJECTED', 'FLAGGED'].includes(sourceStatus)) {
      throw new Error(`Appeal allowed only for REJECTED or FLAGGED transactions (current: ${sourceStatus})`);
    }

    let stored;
    try {
      stored = await appealRepository.createAppeal({
        transactionId,
        customerId,
        sourceTransactionStatus: sourceStatus,
        appealReason: String(appealReason).trim(),
        evidence: evidence || {},
        correlationId: correlationId || transaction.correlationId || uuidv4(),
      });
    } catch (error) {
      if (this._isDuplicateAppealError(error)) {
        throw new Error(`Transaction ${transactionId} has already been appealed`);
      }
      throw error;
    }

    if (this.producer) {
      const createdEvent = {
        event_type: 'appeal.created.v1',
        trace_id: stored.transactionId,
        data: {
          appeal_id: stored.appealId,
          transaction_id: stored.transactionId,
          reason_for_appeal: stored.appealReason,
        },
        eventType: 'appeal.created',
        appealId: stored.appealId,
        transactionId: stored.transactionId,
        customerId: stored.customerId,
        sourceTransactionStatus: stored.sourceTransactionStatus,
        appealReason: stored.appealReason,
        evidence: stored.evidence,
        createdAt: stored.createdAt,
        correlationId: stored.correlationId || uuidv4(),
        sourceService: config.serviceName,
      };

      await publish(
        this.producer,
        config.kafka.outputTopicCreated,
        stored.customerId,
        createdEvent,
        {
          'x-correlation-id': createdEvent.correlationId,
          'x-event-type': 'appeal.created',
        }
      );
    }

    logger.info('Appeal created', {
      appealId: stored.appealId,
      transactionId: stored.transactionId,
      customerId: stored.customerId,
      sourceStatus,
    });

    return stored;
  }

  // Handles list pending.
  async listPending(limit, offset) {
    return appealRepository.listPending(limit, offset);
  }

  async claimAppeal({ appealId, reviewerId, reviewerRole, claimTtlMinutes = 10 }) {
    if (!reviewerId || typeof reviewerId !== 'string') {
      throw new Error('reviewerId is required');
    }

    return appealRepository.claimAppeal(
      appealId,
      reviewerId.trim(),
      reviewerRole || null,
      claimTtlMinutes
    );
  }

  async releaseAppeal({ appealId, reviewerId, reviewerRole, notes }) {
    if (!reviewerId || typeof reviewerId !== 'string') {
      throw new Error('reviewerId is required');
    }

    return appealRepository.releaseAppeal(
      appealId,
      reviewerId.trim(),
      reviewerRole || null,
      notes
    );
  }

  // Handles list by customer.
  async listByCustomer(customerId, limit, offset) {
    return appealRepository.listByCustomer(customerId, limit, offset);
  }

  // Handles get by appeal id.
  async getByAppealId(appealId) {
    return appealRepository.getByAppealId(appealId);
  }

  // Handles resolve appeal.
  async resolveAppeal({
    appealId,
    resolution,
    reviewedBy,
    reviewedRole,
    resolutionNotes,
  }) {
    if (!['UPHOLD', 'REVERSE'].includes(resolution)) {
      throw new Error('resolution must be UPHOLD or REVERSE');
    }

    if (!reviewedBy || typeof reviewedBy !== 'string') {
      throw new Error('reviewedBy is required');
    }

    const existing = await appealRepository.getByAppealId(appealId);
    if (!existing) {
      throw new Error(`Appeal ${appealId} not found`);
    }

    if (existing.currentStatus === 'RESOLVED') {
      throw new Error(`Appeal ${appealId} is already resolved`);
    }

    const updated = await appealRepository.resolveAppeal(appealId, {
      resolution,
      reviewedBy,
      reviewedRole,
      resolutionNotes,
    });

    if (updated?.conflict === 'APPEAL_NOT_CLAIMED_BY_REVIEWER') {
      const claimResult = await appealRepository.claimAppeal(appealId, reviewedBy, reviewedRole || null, 10);
      if (claimResult?.conflict && claimResult.conflict !== 'APPEAL_ALREADY_CLAIMED') {
        throw new Error(`Unable to claim appeal: ${claimResult.conflict}`);
      }

      const retried = await appealRepository.resolveAppeal(appealId, {
        resolution,
        reviewedBy,
        reviewedRole,
        resolutionNotes,
      });
      if (retried) {
        return this._publishResolvedIfNeeded(retried);
      }
    }

    if (!updated) {
      throw new Error(`Appeal ${appealId} could not be resolved`);
    }

    return this._publishResolvedIfNeeded(updated);
  }

  async _publishResolvedIfNeeded(updated) {
    if (updated.conflict) {
      throw new Error(`Appeal ${updated.appealId || 'unknown'} could not be resolved: ${updated.conflict}`);
    }

    if (this.producer) {
      const resolvedEvent = {
        event_type: 'appeal.resolved.v1',
        trace_id: updated.transactionId,
        data: {
          appeal_id: updated.appealId,
          transaction_id: updated.transactionId,
          manual_outcome: updated.resolution === 'REVERSE' ? 'APPROVED' : 'REJECTED',
          outcome_reason: updated.resolutionNotes || `Appeal ${updated.resolution}`,
        },
        eventType: 'appeal.resolved',
        appealId: updated.appealId,
        transactionId: updated.transactionId,
        customerId: updated.customerId,
        resolution: updated.resolution,
        outcome: updated.resolution,
        reviewedBy: updated.reviewedBy,
        reviewedRole: updated.resolvedRole,
        resolutionNotes: updated.resolutionNotes,
        resolvedAt: updated.resolvedAt,
        sourceTransactionStatus: updated.sourceTransactionStatus,
        correlationId: updated.correlationId || uuidv4(),
        sourceService: config.serviceName,
      };

      await publish(
        this.producer,
        config.kafka.outputTopicResolved,
        updated.customerId,
        resolvedEvent,
        {
          'x-correlation-id': resolvedEvent.correlationId,
          'x-event-type': 'appeal.resolved',
          'x-appeal-resolution': updated.resolution,
        }
      );
    }

    logger.info('Appeal resolved', {
      appealId: updated.appealId,
      transactionId: updated.transactionId,
      resolution: updated.resolution,
      reviewedBy: updated.reviewedBy,
    });

    return updated;
  }

  // Handles fetch transaction — reads from local Kafka-populated cache.
  async _fetchTransaction(transactionId) {
    try {
      const pool = getPool();
      const result = await pool.query(
        'SELECT * FROM transactions_cache WHERE transaction_id = $1',
        [transactionId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      // Normalise to camelCase for callers
      return {
        transactionId: row.transaction_id,
        customerId: row.customer_id,
        customer_id: row.customer_id,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        correlationId: row.correlation_id,
        ...(row.raw || {}),
      };
    } catch (err) {
      logger.error('Failed to read transaction from cache', {
        transactionId,
        error: err.message,
      });
      throw new Error('Unable to validate transaction for appeal');
    }
  }

  _isDuplicateAppealError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('already been appealed')
      || (message.includes('duplicate key') && message.includes('transaction'))
    );
  }
}

module.exports = new AppealService();

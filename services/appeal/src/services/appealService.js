const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');
const { publish } = require('../config/kafka');
const appealRepository = require('../repositories/appealRepository');

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
    authHeader,
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

    const transaction = await this._fetchTransaction(transactionId, authHeader);
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

    const stored = await appealRepository.createAppeal({
      transactionId,
      customerId,
      sourceTransactionStatus: sourceStatus,
      appealReason: String(appealReason).trim(),
      evidence: evidence || {},
      correlationId: correlationId || transaction.correlationId || uuidv4(),
    });

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
      resolutionNotes,
    });

    if (!updated) {
      throw new Error(`Appeal ${appealId} could not be resolved`);
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

  // Handles fetch transaction.
  async _fetchTransaction(transactionId, authHeader) {
    try {
      const response = await axios.get(
        `${config.transactionServiceUrl}/transactions/${encodeURIComponent(transactionId)}`,
        {
          timeout: 4000,
          headers: authHeader ? { Authorization: authHeader } : {},
        }
      );

      if (response.status !== 200) {
        return null;
      }

      return response.data || null;
    } catch (err) {
      if (err.response?.status === 404) {
        return null;
      }

      logger.error('Failed to fetch transaction for appeal validation', {
        transactionId,
        error: err.message,
      });
      throw new Error('Unable to validate transaction for appeal');
    }
  }
}

module.exports = new AppealService();

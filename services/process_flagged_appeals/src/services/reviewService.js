const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../config/logger');
const { publish } = require('../config/kafka');
const reviewRepository = require('../repositories/reviewRepository');

class ReviewService {
  constructor() {
    this.producer = null;
  }

  // Handles producer binding.
  setProducer(producer) {
    this.producer = producer;
  }

  // Handles enqueue flagged.
  async enqueueFlagged(event, sourceTopic) {
    if (!event?.transactionId || !event?.customerId) {
      throw new Error('transactionId and customerId are required from flagged event');
    }
    return reviewRepository.upsertFromFlagged(event, sourceTopic);
  }

  async listCases({ status, assignee, limit, offset }) {
    const statuses = status
      ? String(status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : ['PENDING', 'IN_REVIEW'];

    return reviewRepository.listCases({ statuses, assignee, limit, offset });
  }

  // Backward-compatible endpoint.
  async listPending(limit, offset) {
    return reviewRepository.listPending(limit, offset);
  }

  async getReviewByTransaction(transactionId) {
    return reviewRepository.getByTransactionId(transactionId);
  }

  async getCaseHistory(transactionId, limit = 50) {
    return reviewRepository.getHistory(transactionId, limit);
  }

  async claimCase({ transactionId, reviewerId, reviewerRole, claimTtlMinutes = 10 }) {
    if (!reviewerId || typeof reviewerId !== 'string') {
      throw new Error('reviewerId is required');
    }

    return reviewRepository.claimCase(transactionId, reviewerId.trim(), reviewerRole || null, claimTtlMinutes);
  }

  async releaseCase({ transactionId, reviewerId, reviewerRole, notes }) {
    if (!reviewerId || typeof reviewerId !== 'string') {
      throw new Error('reviewerId is required');
    }

    return reviewRepository.releaseCase(transactionId, reviewerId.trim(), reviewerRole || null, notes);
  }

  // Handles apply decision.
  async applyDecision({ transactionId, decision, reviewedBy, reviewedRole, notes }) {
    const allowed = new Set(['APPROVED', 'DECLINED']);
    if (!allowed.has(decision)) {
      throw new Error('decision must be APPROVED or DECLINED');
    }

    const existing = await reviewRepository.getByTransactionId(transactionId);
    if (!existing) {
      throw new Error(`No manual review record for transaction ${transactionId}`);
    }
    if (!this.producer) {
      throw new Error('Kafka producer is not ready');
    }

    let updated = await reviewRepository.applyReviewDecision(
      transactionId,
      decision,
      reviewedBy,
      reviewedRole,
      notes
    );

    // Legacy analyst flows resolve directly from the queue without an explicit
    // "claim" step, so we auto-claim once and retry to preserve compatibility.
    if (updated?.conflict === 'CASE_NOT_CLAIMED_BY_REVIEWER') {
      const claimResult = await reviewRepository.claimCase(transactionId, reviewedBy, reviewedRole || null, 10);
      if (claimResult?.conflict && claimResult.conflict !== 'CASE_ALREADY_CLAIMED') {
        throw new Error(`Unable to claim review case: ${claimResult.conflict}`);
      }

      updated = await reviewRepository.applyReviewDecision(
        transactionId,
        decision,
        reviewedBy,
        reviewedRole,
        notes
      );
    }

    if (!updated) {
      throw new Error(`No manual review record for transaction ${transactionId}`);
    }

    if (updated.conflict) {
      throw new Error(`Unable to apply manual review decision: ${updated.conflict}`);
    }

    const correlationId = existing.correlationId || uuidv4();
    const reviewedEvent = {
      event_type: 'transaction.reviewed.v1',
      trace_id: updated.transactionId,
      data: {
        transaction_id: updated.transactionId,
        manual_outcome: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reason: notes || null,
      },
      eventType: 'transaction.reviewed',
      transactionId: updated.transactionId,
      customerId: updated.customerId,
      merchantId: updated.merchantId,
      previousDecision: 'FLAGGED',
      reviewDecision: decision,
      decision,
      reviewNotes: notes || null,
      reviewedBy,
      reviewedRole: reviewedRole || null,
      reviewedAt: updated.reviewedAt,
      correlationId,
      sourceService: config.serviceName,
    };

    await publish(
      this.producer,
      config.kafka.outputTopicReviewed,
      updated.customerId,
      reviewedEvent,
      {
        'x-correlation-id': correlationId,
        'x-review-decision': decision,
      }
    );

    logger.info('Manual review decision published', {
      transactionId: updated.transactionId,
      decision,
      reviewedBy,
      outputTopic: config.kafka.outputTopicReviewed,
    });

    return updated;
  }
}

module.exports = new ReviewService();

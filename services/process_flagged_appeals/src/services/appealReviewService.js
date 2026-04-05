const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');

const toError = (err, fallbackMessage) => {
  const status = err.response?.status;
  const message = err.response?.data?.error || err.response?.data?.message || err.message || fallbackMessage;
  const wrapped = new Error(message);
  wrapped.statusCode = status || 500;
  return wrapped;
};

class AppealReviewService {
  buildForwardHeaders({ authHeader, correlationId }) {
    return {
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    };
  }

  normalizeTransactionSummary(appeal, transaction, decision) {
    return {
      amount: transaction?.amount ?? null,
      currency: transaction?.currency ?? null,
      country: transaction?.country ?? null,
      merchantId: transaction?.merchant_id ?? null,
      cardType: transaction?.card_type ?? null,
      senderName: transaction?.sender_name ?? null,
      recipientCustomerId: transaction?.recipient_customer_id ?? null,
      recipientName: transaction?.recipient_name ?? null,
      transactionStatus: transaction?.status || decision?.status || appeal?.sourceTransactionStatus || null,
      fraudScore: decision?.fraud_score ?? null,
      outcomeReason: decision?.outcome_reason ?? null,
      createdAt: transaction?.created_at ?? null,
      updatedAt: transaction?.updated_at ?? null,
    };
  }

  async fetchTransactionDetails(transactionId, headers) {
    const baseUrl = `${config.transactionService.baseUrl}/api/v1/transactions/${encodeURIComponent(transactionId)}`;
    const requestOptions = {
      timeout: config.transactionService.timeoutMs,
      headers,
    };

    const [transactionResult, decisionResult] = await Promise.allSettled([
      axios.get(baseUrl, requestOptions),
      axios.get(`${baseUrl}/decision`, requestOptions),
    ]);

    if (transactionResult.status === 'rejected') {
      logger.warn('Failed to fetch linked transaction for appeal queue item', {
        transactionId,
        error: transactionResult.reason?.message || 'unknown error',
      });
    }

    if (decisionResult.status === 'rejected') {
      logger.warn('Failed to fetch linked transaction decision for appeal queue item', {
        transactionId,
        error: decisionResult.reason?.message || 'unknown error',
      });
    }

    return {
      transaction: transactionResult.status === 'fulfilled' ? transactionResult.value.data : null,
      transactionDecision: decisionResult.status === 'fulfilled' ? decisionResult.value.data : null,
    };
  }

  async enrichAppeal(appeal, headers) {
    if (!appeal?.transactionId) {
      return {
        ...appeal,
        transaction: null,
        transactionDecision: null,
        transactionSummary: null,
      };
    }

    const { transaction, transactionDecision } = await this.fetchTransactionDetails(appeal.transactionId, headers);
    return {
      ...appeal,
      transaction,
      transactionDecision,
      transactionSummary: this.normalizeTransactionSummary(appeal, transaction, transactionDecision),
    };
  }

  // Handles list pending appeals through appeal-service.
  async listPendingAppeals({ limit = 20, offset = 0, authHeader, correlationId }) {
    try {
      const headers = this.buildForwardHeaders({ authHeader, correlationId });
      const response = await axios.get(
        `${config.appealService.baseUrl}/api/v1/internal/appeals/pending`,
        {
          timeout: config.appealService.timeoutMs,
          params: { limit, offset },
          headers,
        }
      );
      const appeals = response.data?.data || [];
      return Promise.all(appeals.map((appeal) => this.enrichAppeal(appeal, headers)));
    } catch (err) {
      logger.error('Failed to list pending appeals via appeal-service', {
        error: err.message,
      });
      throw toError(err, 'Unable to list pending appeals');
    }
  }

  async claimAppeal({ appealId, reviewerId, reviewerRole, claimTtlMinutes = 10, authHeader, correlationId }) {
    try {
      const response = await axios.post(
        `${config.appealService.baseUrl}/api/v1/internal/appeals/${encodeURIComponent(appealId)}/claim`,
        {
          reviewerId,
          reviewerRole,
          claimTtlMinutes,
        },
        {
          timeout: config.appealService.timeoutMs,
          headers: this.buildForwardHeaders({ authHeader, correlationId }),
        }
      );
      return response.data?.data || null;
    } catch (err) {
      logger.error('Failed to claim appeal via appeal-service', {
        appealId,
        reviewerId,
        error: err.message,
      });
      throw toError(err, 'Unable to claim appeal');
    }
  }

  async releaseAppeal({ appealId, reviewerId, reviewerRole, notes, authHeader, correlationId }) {
    try {
      const response = await axios.post(
        `${config.appealService.baseUrl}/api/v1/internal/appeals/${encodeURIComponent(appealId)}/release`,
        {
          reviewerId,
          reviewerRole,
          notes: notes || null,
        },
        {
          timeout: config.appealService.timeoutMs,
          headers: this.buildForwardHeaders({ authHeader, correlationId }),
        }
      );
      return response.data?.data || null;
    } catch (err) {
      logger.error('Failed to release appeal via appeal-service', {
        appealId,
        reviewerId,
        error: err.message,
      });
      throw toError(err, 'Unable to release appeal');
    }
  }

  // Handles resolve appeal through appeal-service.
  async resolveAppeal({ appealId, resolution, reviewedBy, reviewedRole, notes, authHeader, correlationId }) {
    try {
      const response = await axios.post(
        `${config.appealService.baseUrl}/api/v1/internal/appeals/${encodeURIComponent(appealId)}/resolve`,
        {
          resolution,
          reviewedBy,
          reviewedRole,
          notes: notes || null,
        },
        {
          timeout: config.appealService.timeoutMs,
          headers: this.buildForwardHeaders({ authHeader, correlationId }),
        }
      );
      return response.data?.data || null;
    } catch (err) {
      logger.error('Failed to resolve appeal via appeal-service', {
        appealId,
        resolution,
        reviewedBy,
        reviewedRole,
        error: err.message,
      });
      throw toError(err, 'Unable to resolve appeal');
    }
  }
}

module.exports = new AppealReviewService();

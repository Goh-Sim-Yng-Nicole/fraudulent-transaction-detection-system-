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
  // Handles list pending appeals through appeal-service.
  async listPendingAppeals({ limit = 20, offset = 0, authHeader, correlationId }) {
    try {
      const response = await axios.get(
        `${config.appealService.baseUrl}/api/v1/internal/appeals/pending`,
        {
          timeout: config.appealService.timeoutMs,
          params: { limit, offset },
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
          },
        }
      );
      return response.data?.data || [];
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
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
          },
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
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
          },
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
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
          },
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

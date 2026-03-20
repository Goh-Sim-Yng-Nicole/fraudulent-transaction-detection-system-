const axios = require('axios');
const config = require('../config');
const CircuitBreaker = require('./circuitBreaker');

const breaker = new CircuitBreaker();

const normalizeResponse = (data, fallbackScore) => {
  if (!data) {
    return {
      score: fallbackScore,
      confidence: null,
      modelVersion: 'fallback-v1'
    };
  }

  if (typeof data.rules_score === 'number') {
    return {
      score: data.rules_score,
      confidence: typeof data.confidence === 'number' ? data.confidence : null,
      modelVersion: data.model_version || 'ftds-risk-model'
    };
  }

  if (data.success && data.data && typeof data.data.score === 'number') {
    return {
      score: data.data.score,
      confidence: typeof data.data.confidence === 'number' ? data.data.confidence : null,
      modelVersion: data.data.modelVersion || data.data.model_version || 'ftds-risk-model'
    };
  }

  return {
    score: fallbackScore,
    confidence: null,
    modelVersion: 'fallback-v1'
  };
};

class MlScoringClient {
  constructor() {
    this.http = axios.create({
      timeout: config.mlScoring.timeoutMs
    });
  }

  async score(transaction, ruleResults) {
    const fallbackScore = Math.min(95, Math.round(ruleResults.ruleScore * 0.9) || 35);
    if (breaker.isOpen()) {
      return normalizeResponse(null, fallbackScore);
    }

    const url = config.mlScoring.url;
    const modernPayload = {
      transaction: {
        id: transaction.id,
        customerId: transaction.customerId,
        merchantId: transaction.merchantId,
        amount: transaction.amount,
        currency: transaction.currency,
        cardType: transaction.cardType,
        location: transaction.location || {},
        metadata: transaction.metadata || {},
        createdAt: transaction.createdAt
      },
      ruleResults
    };

    try {
      const response = await this.http.post(
        url.includes('/api/v1/') ? url : url.replace(/\/score$/, '/api/v1/score'),
        modernPayload
      );
      breaker.recordSuccess();
      return normalizeResponse(response.data, fallbackScore);
    } catch (_error) {
      breaker.recordFailure();
      try {
        const legacyResponse = await this.http.post(url, {
          amount: transaction.amount,
          currency: transaction.currency,
          card_type: transaction.cardType,
          country: transaction.location?.country || 'SG',
          hour_utc: new Date(transaction.createdAt).getUTCHours(),
          merchant_id: transaction.merchantId,
          velocity_txn_hour_raw: ruleResults.riskFactors.velocity?.countLastHour || 0,
          geo_country_high_risk: Boolean(ruleResults.riskFactors.geography?.highRiskCountry)
        });
        breaker.recordSuccess();
        return normalizeResponse(legacyResponse.data, fallbackScore);
      } catch (_legacyError) {
        return normalizeResponse(null, fallbackScore);
      }
    }
  }
}

module.exports = new MlScoringClient();

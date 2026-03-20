const axios = require('axios');
const { CompressionTypes } = require('kafkajs');
const config = require('../config');
const logger = require('../config/logger');

const flaggedEventType = 'transaction.flagged';
const finalisedEventType = 'transaction.finalised';

class DecisionPublisher {
  constructor() {
    this.decisionVersion = 'detect-fraud-local-fallback-1.0.0';
  }

  async process({ producer, transaction, fraudAnalysis, correlationId }) {
    if (!producer) {
      throw new Error('Kafka producer is required to publish decision events');
    }

    if (config.decision.outsystemsUrl) {
      const externallyHandled = await this._sendToOutSystems({
        producer,
        transaction,
        fraudAnalysis,
        correlationId,
      });

      if (externallyHandled) {
        return;
      }
    }

    if (!config.decision.localFallbackEnabled) {
      logger.warn('Decision handoff skipped because no local fallback is enabled', {
        transactionId: transaction.id,
        outsystemsConfigured: Boolean(config.decision.outsystemsUrl),
      });
      return;
    }

    const decisionResult = this._makeLocalDecision(fraudAnalysis, transaction);
    await this._publishDecisionEvent({
      producer,
      transaction,
      fraudAnalysis,
      correlationId,
      decisionResult,
      source: config.decision.outsystemsUrl ? 'local-fallback' : 'local-default',
    });
  }

  async _sendToOutSystems({ producer, transaction, fraudAnalysis, correlationId }) {
    try {
      const response = await axios.post(
        config.decision.outsystemsUrl,
        {
          eventType: 'transaction.scored',
          transactionId: transaction.id,
          customerId: transaction.customerId,
          merchantId: transaction.merchantId,
          correlationId,
          originalTransaction: transaction,
          fraudAnalysis,
          processedAt: new Date().toISOString(),
        },
        {
          timeout: config.decision.timeoutMs,
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            'X-Correlation-ID': correlationId,
            'X-Service-Source': config.serviceName,
          },
        }
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`OutSystems returned ${response.status}`);
      }

      const decisionResult = this._normalizeExternalDecision(response.data);
      if (decisionResult) {
        await this._publishDecisionEvent({
          producer,
          transaction,
          fraudAnalysis,
          correlationId,
          decisionResult,
          source: 'outsystems-sync',
        });
      } else {
        logger.info('Fraud score forwarded to OutSystems decision endpoint', {
          transactionId: transaction.id,
          responseStatus: response.status,
          mode: 'external-only',
        });
      }

      return true;
    } catch (error) {
      logger.warn('OutSystems decision handoff failed', {
        transactionId: transaction.id,
        error: error.message,
        localFallbackEnabled: config.decision.localFallbackEnabled,
      });
      return false;
    }
  }

  _normalizeExternalDecision(body) {
    const payload = body?.data || body;
    const rawDecision = String(payload?.decision || payload?.outcome || '').toUpperCase();
    const decision = rawDecision === 'REJECTED' ? 'DECLINED' : rawDecision;

    if (!['APPROVED', 'DECLINED', 'FLAGGED'].includes(decision)) {
      return null;
    }

    return {
      decision,
      decisionReason: payload?.decisionReason || payload?.reason || payload?.outcomeReason || 'Decision returned by OutSystems',
      decisionFactors: payload?.decisionFactors || payload?.factors || { source: 'OUTSYSTEMS' },
      overrideApplied: Boolean(payload?.overrideApplied),
      overrideReason: payload?.overrideReason || null,
      overrideType: payload?.overrideType || 'OUTSYSTEMS',
      decisionVersion: payload?.decisionVersion || payload?.version || 'outsystems',
    };
  }

  _makeLocalDecision(fraudAnalysis, originalTransaction) {
    const { thresholds, businessRules } = config.decision;
    const decisionFactors = {};
    let decision = null;
    const reasons = [];
    let override = null;

    const listOverride = this._checkLists(fraudAnalysis.customerId, businessRules);
    if (listOverride) {
      decision = listOverride.decision;
      reasons.push(listOverride.reason);
      override = listOverride;
      decisionFactors.listOverride = true;
      return this._buildDecisionResult(decision, reasons, decisionFactors, override);
    }

    if (thresholds.rulesFlaggedAutoDecline && fraudAnalysis.ruleResults?.flagged) {
      decision = 'DECLINED';
      reasons.push('Rules engine flagged transaction');
      decisionFactors.rulesFlagged = true;
      return this._buildDecisionResult(decision, reasons, decisionFactors, null);
    }

    const confidenceAdjustment = this._applyConfidenceAdjustment(
      fraudAnalysis.riskScore,
      fraudAnalysis.mlResults?.confidence,
      thresholds
    );
    const adjustedScore = confidenceAdjustment.adjustedScore;
    decisionFactors.confidenceAdjustment = confidenceAdjustment;

    const certaintyAutoDecline = this._checkCertaintyAutoDecline(
      adjustedScore,
      fraudAnalysis.mlResults?.confidence,
      thresholds
    );
    if (certaintyAutoDecline) {
      decision = 'DECLINED';
      reasons.push(certaintyAutoDecline.reason);
      decisionFactors.certaintyAutoDecline = true;
      decisionFactors.thresholdBased = true;
      decisionFactors.adjustedScore = adjustedScore;
      decisionFactors.originalScore = fraudAnalysis.riskScore;
      return this._buildDecisionResult(decision, reasons, decisionFactors, null);
    }

    const highValueOverride = this._checkHighValue(originalTransaction, thresholds);
    if (highValueOverride) {
      decision = highValueOverride.decision;
      reasons.push(highValueOverride.reason);
      decisionFactors.highValue = true;
      return this._buildDecisionResult(decision, reasons, decisionFactors, highValueOverride);
    }

    const geoOverride = this._checkGeography(originalTransaction, businessRules);
    if (geoOverride) {
      decision = geoOverride.decision;
      reasons.push(geoOverride.reason);
      decisionFactors.geographicRisk = true;
      return this._buildDecisionResult(decision, reasons, decisionFactors, geoOverride);
    }

    if (adjustedScore <= thresholds.approveMax) {
      decision = 'APPROVED';
      reasons.push(`Risk score ${adjustedScore} below approval threshold (${thresholds.approveMax})`);
    } else if (adjustedScore >= thresholds.declineMin) {
      decision = 'DECLINED';
      reasons.push(`Risk score ${adjustedScore} exceeds decline threshold (${thresholds.declineMin})`);
    } else {
      decision = 'FLAGGED';
      reasons.push(`Risk score ${adjustedScore} in manual review range (${thresholds.flagMin}-${thresholds.flagMax})`);
    }

    decisionFactors.thresholdBased = true;
    decisionFactors.adjustedScore = adjustedScore;
    decisionFactors.originalScore = fraudAnalysis.riskScore;

    return this._buildDecisionResult(decision, reasons, decisionFactors, override);
  }

  _checkLists(customerId, businessRules) {
    if (businessRules.autoApproveWhitelist.includes(customerId)) {
      return {
        decision: 'APPROVED',
        reason: 'Customer on auto-approve whitelist',
        type: 'WHITELIST',
      };
    }

    if (businessRules.autoDeclineBlacklist.includes(customerId)) {
      return {
        decision: 'DECLINED',
        reason: 'Customer on auto-decline blacklist',
        type: 'BLACKLIST',
      };
    }

    return null;
  }

  _checkCertaintyAutoDecline(adjustedScore, confidence, thresholds) {
    if (!thresholds.certaintyAutoDeclineEnabled || !Number.isFinite(confidence)) {
      return null;
    }

    if (
      adjustedScore >= thresholds.certaintyDeclineMinScore
      && confidence >= thresholds.certaintyDeclineMinConfidence
    ) {
      return {
        decision: 'DECLINED',
        reason: `High-certainty fraud signal (score ${adjustedScore}, confidence ${confidence}) auto-declined`,
        type: 'CERTAINTY_AUTO_DECLINE',
      };
    }

    return null;
  }

  _checkHighValue(transaction, thresholds) {
    if (thresholds.highValueAutoFlag && Number(transaction.amount) >= thresholds.highValueAmount) {
      return {
        decision: 'FLAGGED',
        reason: `High-value transaction ($${transaction.amount}) requires manual review`,
        type: 'HIGH_VALUE',
      };
    }

    return null;
  }

  _checkGeography(transaction, businessRules) {
    const country = String(transaction.location?.country || '').toUpperCase();
    if (country && businessRules.requireManualReviewCountries.includes(country)) {
      return {
        decision: 'FLAGGED',
        reason: `Transaction from high-risk country (${country}) requires manual review`,
        type: 'GEOGRAPHIC_RISK',
      };
    }

    return null;
  }

  _applyConfidenceAdjustment(riskScore, confidence, thresholds) {
    if (!Number.isFinite(confidence)) {
      return {
        adjustedScore: riskScore,
        confidenceUsed: false,
        adjustment: 0,
      };
    }

    let adjustment = 0;
    if (confidence >= thresholds.highConfidenceApprove && riskScore <= 60) {
      adjustment = -5;
    }
    if (confidence < thresholds.lowConfidenceFlag && riskScore >= 40) {
      adjustment = +10;
    }

    return {
      adjustedScore: Math.max(0, Math.min(100, riskScore + adjustment)),
      confidenceUsed: true,
      adjustment,
      originalConfidence: confidence,
    };
  }

  _buildDecisionResult(decision, reasons, decisionFactors, override) {
    return {
      decision,
      decisionReason: reasons.join('; '),
      decisionFactors,
      overrideApplied: override !== null,
      overrideReason: override?.reason || null,
      overrideType: override?.type || null,
      decisionVersion: this.decisionVersion,
    };
  }

  async _publishDecisionEvent({
    producer,
    transaction,
    fraudAnalysis,
    correlationId,
    decisionResult,
    source,
  }) {
    const isFlagged = decisionResult.decision === 'FLAGGED';
    const eventType = isFlagged ? flaggedEventType : finalisedEventType;
    const topic = isFlagged ? config.kafka.flaggedTopic : config.kafka.finalisedTopic;
    const processedAt = new Date().toISOString();

    const payload = {
      event_type: `${eventType}.v1`,
      trace_id: transaction.id,
      data: isFlagged
        ? {
            transaction_id: transaction.id,
            rules_score: fraudAnalysis.riskScore,
            reason: decisionResult.decisionReason,
          }
        : {
            transaction_id: transaction.id,
            outcome: decisionResult.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
            rules_score: fraudAnalysis.riskScore,
            reason: decisionResult.decisionReason,
          },
      eventType,
      transactionId: transaction.id,
      customerId: transaction.customerId,
      merchantId: transaction.merchantId,
      decision: decisionResult.decision,
      decisionReason: decisionResult.decisionReason,
      decisionFactors: decisionResult.decisionFactors,
      originalTransaction: transaction,
      fraudAnalysis,
      processedAt,
      decidedAt: processedAt,
      correlationId,
      sourceService: config.serviceName,
      decisionVersion: decisionResult.decisionVersion,
      overrideApplied: decisionResult.overrideApplied,
      overrideReason: decisionResult.overrideReason,
      overrideType: decisionResult.overrideType,
      decisionSource: source,
    };

    await producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: String(transaction.customerId),
          value: JSON.stringify(payload),
          headers: {
            'content-type': 'application/json',
            'service-source': config.serviceName,
            'x-correlation-id': correlationId,
            'x-decision': decisionResult.decision,
            'x-decision-source': source,
          },
        },
      ],
    });

    logger.info('Published transaction decision event', {
      transactionId: transaction.id,
      topic,
      decision: decisionResult.decision,
      source,
    });
  }
}

module.exports = new DecisionPublisher();

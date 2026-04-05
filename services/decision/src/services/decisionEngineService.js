const config = require('../config');
const logger = require('../config/logger');


class DecisionEngineService {
  constructor() {
    this.decisionVersion = '1.0.0';
  }

  
  // Handles make decision.
  makeDecision(fraudAnalysis, originalTransaction) {
    const log = logger.child({
      transactionId: fraudAnalysis.transactionId,
      customerId: fraudAnalysis.customerId,
    });

    log.info('Making decision', {
      riskScore: fraudAnalysis.riskScore,
      flagged: fraudAnalysis.flagged,
    });

    const decisionFactors = {};
    let decision = null;
    let reasons = [];
    let override = null;
    const listOverride = this._checkLists(fraudAnalysis.customerId);
    if (listOverride) {
      decision = listOverride.decision;
      reasons.push(listOverride.reason);
      override = listOverride;
      decisionFactors.listOverride = true;
      
      log.info('List override applied', {
        decision,
        reason: listOverride.reason,
      });

      return this._buildDecisionResult(decision, reasons, decisionFactors, override);
    }
    if (config.thresholds.rulesFlaggedAutoDecline && fraudAnalysis.ruleResults?.flagged) {
      decision = 'DECLINED';
      reasons.push('Rules engine flagged transaction');
      decisionFactors.rulesFlagged = true;

      log.info('Auto-declined by rules engine', {
        ruleReasons: fraudAnalysis.ruleResults.reasons,
      });

      return this._buildDecisionResult(decision, reasons, decisionFactors, null);
    }
    const confidenceAdjustment = this._applyConfidenceAdjustment(
      fraudAnalysis.riskScore,
      fraudAnalysis.mlResults?.confidence
    );
    const adjustedScore = confidenceAdjustment.adjustedScore;
    decisionFactors.confidenceAdjustment = confidenceAdjustment;

    const certaintyAutoDecline = this._checkCertaintyAutoDecline(
      adjustedScore,
      fraudAnalysis.mlResults?.confidence
    );
    if (certaintyAutoDecline) {
      decision = 'DECLINED';
      reasons.push(certaintyAutoDecline.reason);
      decisionFactors.certaintyAutoDecline = true;
      decisionFactors.thresholdBased = true;
      decisionFactors.adjustedScore = adjustedScore;
      decisionFactors.originalScore = fraudAnalysis.riskScore;

      log.info('Auto-declined by certainty threshold', {
        decision,
        adjustedScore,
        confidence: fraudAnalysis.mlResults?.confidence,
        minScore: config.thresholds.certaintyDeclineMinScore,
        minConfidence: config.thresholds.certaintyDeclineMinConfidence,
      });

      return this._buildDecisionResult(decision, reasons, decisionFactors, null);
    }
    if (adjustedScore >= config.thresholds.declineMin) {
      decision = 'DECLINED';
      reasons.push(`Risk score ${adjustedScore} exceeds decline threshold (${config.thresholds.declineMin})`);
      decisionFactors.thresholdBased = true;
      decisionFactors.adjustedScore = adjustedScore;
      decisionFactors.originalScore = fraudAnalysis.riskScore;

      log.info('Auto-declined by score threshold', {
        decision,
        originalScore: fraudAnalysis.riskScore,
        adjustedScore,
        confidence: fraudAnalysis.mlResults?.confidence,
      });

      return this._buildDecisionResult(decision, reasons, decisionFactors, null);
    }
    if (adjustedScore <= config.thresholds.approveMax) {
      decision = 'APPROVED';
      reasons.push(`Risk score ${adjustedScore} below approval threshold (${config.thresholds.approveMax})`);
      decisionFactors.thresholdBased = true;
      decisionFactors.adjustedScore = adjustedScore;
      decisionFactors.originalScore = fraudAnalysis.riskScore;

      log.info('Auto-approved by score threshold', {
        decision,
        originalScore: fraudAnalysis.riskScore,
        adjustedScore,
        confidence: fraudAnalysis.mlResults?.confidence,
      });

      return this._buildDecisionResult(decision, reasons, decisionFactors, null);
    }
    const highValueOverride = this._checkHighValue(originalTransaction);
    if (highValueOverride) {
      decision = highValueOverride.decision;
      reasons.push(highValueOverride.reason);
      decisionFactors.highValue = true;

      log.info('High-value override applied', {
        amount: originalTransaction.amount,
        decision,
      });

      return this._buildDecisionResult(decision, reasons, decisionFactors, highValueOverride);
    }
    const geoOverride = this._checkGeography(originalTransaction);
    if (geoOverride) {
      decision = geoOverride.decision;
      reasons.push(geoOverride.reason);
      decisionFactors.geographicRisk = true;

      log.info('Geographic override applied', {
        country: originalTransaction.location?.country,
        decision,
      });

      return this._buildDecisionResult(decision, reasons, decisionFactors, geoOverride);
    }
    decision = 'FLAGGED';
    reasons.push(`Risk score ${adjustedScore} in manual review range (${config.thresholds.flagMin}-${config.thresholds.flagMax})`);

    decisionFactors.thresholdBased = true;
    decisionFactors.adjustedScore = adjustedScore;
    decisionFactors.originalScore = fraudAnalysis.riskScore;

    log.info('Decision made', {
      decision,
      originalScore: fraudAnalysis.riskScore,
      adjustedScore,
      confidence: fraudAnalysis.mlResults?.confidence,
    });

    return this._buildDecisionResult(decision, reasons, decisionFactors, override);
  }

  // Handles check lists.
  _checkLists(customerId) {
    if (config.businessRules.autoApproveWhitelist.includes(customerId)) {
      return {
        decision: 'APPROVED',
        reason: 'Customer on auto-approve whitelist',
        type: 'WHITELIST',
      };
    }
    if (config.businessRules.autoDeclineBlacklist.includes(customerId)) {
      return {
        decision: 'DECLINED',
        reason: 'Customer on auto-decline blacklist',
        type: 'BLACKLIST',
      };
    }

    return null;
  }

  // Handles certainty auto-decline.
  _checkCertaintyAutoDecline(adjustedScore, confidence) {
    if (!config.thresholds.certaintyAutoDeclineEnabled) {
      return null;
    }

    if (!Number.isFinite(confidence)) {
      return null;
    }

    if (
      adjustedScore >= config.thresholds.certaintyDeclineMinScore &&
      confidence >= config.thresholds.certaintyDeclineMinConfidence
    ) {
      return {
        decision: 'DECLINED',
        reason: `High-certainty fraud signal (score ${adjustedScore}, confidence ${confidence}) auto-declined`,
        type: 'CERTAINTY_AUTO_DECLINE',
      };
    }

    return null;
  }

  // Handles check high value.
  _checkHighValue(transaction) {
    if (
      config.thresholds.highValueAutoFlag &&
      transaction.amount >= config.thresholds.highValueAmount
    ) {
      return {
        decision: 'FLAGGED',
        reason: `High-value transaction ($${transaction.amount}) requires manual review`,
        type: 'HIGH_VALUE',
      };
    }

    return null;
  }

  // Handles check geography.
  _checkGeography(transaction) {
    const country = transaction.location?.country?.toUpperCase();

    if (country && config.businessRules.requireManualReviewCountries.includes(country)) {
      return {
        decision: 'FLAGGED',
        reason: `Transaction from high-risk country (${country}) requires manual review`,
        type: 'GEOGRAPHIC_RISK',
      };
    }

    return null;
  }

  // Handles apply confidence adjustment.
  _applyConfidenceAdjustment(riskScore, confidence) {
    if (!Number.isFinite(confidence)) {
      return {
        adjustedScore: riskScore,
        confidenceUsed: false,
        adjustment: 0,
      };
    }

    let adjustment = 0;
    if (confidence >= config.thresholds.highConfidenceApprove && riskScore <= 60) {
      adjustment = -5;
    }
    if (confidence < config.thresholds.lowConfidenceFlag && riskScore >= 40) {
      adjustment = +10;
    }

    const adjustedScore = Math.max(0, Math.min(100, riskScore + adjustment));

    return {
      adjustedScore,
      confidenceUsed: true,
      adjustment,
      originalConfidence: confidence,
    };
  }

  // Handles build decision result.
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

  
  // Handles get thresholds.
  getThresholds() {
    return {
      approve: { max: config.thresholds.approveMax },
      flag: { min: config.thresholds.flagMin, max: config.thresholds.flagMax },
      decline: { min: config.thresholds.declineMin },
      highValue: { amount: config.thresholds.highValueAmount },
      confidence: {
        highApprove: config.thresholds.highConfidenceApprove,
        lowFlag: config.thresholds.lowConfidenceFlag,
        certaintyAutoDeclineEnabled: config.thresholds.certaintyAutoDeclineEnabled,
        certaintyDeclineMinScore: config.thresholds.certaintyDeclineMinScore,
        certaintyDeclineMinConfidence: config.thresholds.certaintyDeclineMinConfidence,
      },
    };
  }
}

module.exports = new DecisionEngineService();

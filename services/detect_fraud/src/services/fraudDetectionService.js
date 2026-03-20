const config = require('../config');
const fraudRulesEngine = require('../rules/fraudRulesEngine');
const mlScoringClient = require('./mlScoringClient');

class FraudDetectionService {
  async analyzeTransaction(transaction) {
    const ruleResults = await fraudRulesEngine.evaluate(transaction);
    const mlResults = await mlScoringClient.score(transaction, ruleResults);

    const riskScore = Math.round(
      ruleResults.ruleScore * config.combination.rulesWeight +
      mlResults.score * config.combination.mlWeight
    );

    const flagged = ruleResults.flagged || mlResults.score >= config.combination.mlFlagThreshold;
    const reasons = [...ruleResults.reasons];
    if (mlResults.score >= config.combination.mlFlagThreshold) {
      reasons.push(`ml score exceeded threshold (${mlResults.score}/${config.combination.mlFlagThreshold})`);
    }

    return {
      transactionId: transaction.id,
      customerId: transaction.customerId,
      merchantId: transaction.merchantId,
      amount: transaction.amount,
      currency: transaction.currency,
      riskScore,
      flagged,
      reasons,
      ruleResults,
      mlResults,
      analyzedAt: new Date().toISOString(),
      analysisVersion: '2.0.0'
    };
  }
}

module.exports = new FraudDetectionService();

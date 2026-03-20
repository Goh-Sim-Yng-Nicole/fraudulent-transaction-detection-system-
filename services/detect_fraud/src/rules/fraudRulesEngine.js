const config = require('../config');
const velocityStore = require('../services/velocityStore');

class FraudRulesEngine {
  async evaluate(transaction) {
    const reasons = [];
    const riskFactors = {};
    let flagged = false;
    let ruleScore = 0;

    const velocity = await velocityStore.record(transaction.customerId, Number(transaction.amount));
    riskFactors.velocity = velocity;
    if (velocity.countLastHour > config.rules.maxTxnPerHour) {
      flagged = true;
      ruleScore += 20;
      reasons.push(`velocity count exceeded (${velocity.countLastHour}/${config.rules.maxTxnPerHour})`);
    }
    if (velocity.amountLastHour > config.rules.maxAmountPerHour) {
      flagged = true;
      ruleScore += 20;
      reasons.push(`velocity amount exceeded (${velocity.amountLastHour}/${config.rules.maxAmountPerHour})`);
    }

    const country = String(transaction.location?.country || '').toUpperCase();
    riskFactors.geography = {
      country,
      highRiskCountry: config.rules.highRiskCountries.includes(country)
    };
    if (riskFactors.geography.highRiskCountry) {
      flagged = true;
      ruleScore += 25;
      reasons.push(`high-risk geography (${country})`);
    }

    if (transaction.amount >= config.rules.suspiciousAmountThreshold) {
      flagged = true;
      ruleScore += 35;
      reasons.push(`suspicious amount (${transaction.amount})`);
    } else if (transaction.amount >= config.rules.highAmountThreshold) {
      ruleScore += 15;
      reasons.push(`high amount (${transaction.amount})`);
    }

    const hourUtc = new Date(transaction.createdAt).getUTCHours();
    riskFactors.time = { hourUtc };
    if (hourUtc <= 5 || hourUtc >= 23) {
      ruleScore += 5;
      reasons.push('unusual transaction time');
    }

    if (Math.abs(transaction.amount - Math.round(transaction.amount)) < 1e-9) {
      ruleScore += 5;
      reasons.push('round amount pattern');
    }

    return {
      flagged,
      ruleScore: Math.min(100, Math.round(ruleScore)),
      reasons,
      riskFactors
    };
  }
}

module.exports = new FraudRulesEngine();

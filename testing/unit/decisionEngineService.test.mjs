import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCommonJsWithMocks } from './loadCommonJsWithMocks.mjs';

function loadDecisionEngineService(overrides = {}) {
  return loadCommonJsWithMocks(
    './services/decision/src/services/decisionEngineService.js',
    {
      '../config': {
        thresholds: {
          approveMax: 49,
          flagMin: 50,
          flagMax: 75,
          declineMin: 76,
          rulesFlaggedAutoDecline: false,
          certaintyAutoDeclineEnabled: false,
          certaintyDeclineMinScore: 70,
          certaintyDeclineMinConfidence: 0.9,
          highConfidenceApprove: 0.95,
          lowConfidenceFlag: 0.6,
          highValueAmount: 10000,
          highValueAutoFlag: false,
          ...overrides.thresholds,
        },
        businessRules: {
          autoApproveWhitelist: [],
          autoDeclineBlacklist: [],
          requireManualReviewCountries: [],
          ...overrides.businessRules,
        },
      },
      '../config/logger': {
        child: () => ({
          info: () => {},
          warn: () => {},
          error: () => {},
        }),
      },
    }
  );
}

function makeFraudAnalysis(riskScore) {
  return {
    transactionId: `txn-${riskScore}`,
    customerId: 'customer-1',
    riskScore,
    flagged: false,
    mlResults: {},
    ruleResults: {
      flagged: false,
      reasons: [],
    },
  };
}

function makeTransaction() {
  return {
    amount: 120,
    location: { country: 'SG' },
  };
}

test('scores above 75 are auto-declined', () => {
  const decisionEngineService = loadDecisionEngineService();

  const result = decisionEngineService.makeDecision(makeFraudAnalysis(76), makeTransaction());

  assert.equal(result.decision, 'DECLINED');
  assert.match(result.decisionReason, /decline threshold \(76\)/);
  assert.equal(result.decisionFactors.adjustedScore, 76);
});

test('score 75 remains in the manual review band', () => {
  const decisionEngineService = loadDecisionEngineService();

  const result = decisionEngineService.makeDecision(makeFraudAnalysis(75), makeTransaction());

  assert.equal(result.decision, 'FLAGGED');
  assert.match(result.decisionReason, /manual review range \(50-75\)/);
  assert.equal(result.decisionFactors.adjustedScore, 75);
});

test('score above 75 is declined even when manual review overrides would otherwise apply', () => {
  const decisionEngineService = loadDecisionEngineService({
    thresholds: {
      highValueAutoFlag: true,
      highValueAmount: 100,
    },
    businessRules: {
      requireManualReviewCountries: ['NG'],
    },
  });

  const result = decisionEngineService.makeDecision(
    makeFraudAnalysis(88),
    {
      amount: 5000,
      location: { country: 'NG' },
    }
  );

  assert.equal(result.decision, 'DECLINED');
  assert.match(result.decisionReason, /decline threshold \(76\)/);
  assert.equal(result.decisionFactors.highValue, undefined);
  assert.equal(result.decisionFactors.geographicRisk, undefined);
});

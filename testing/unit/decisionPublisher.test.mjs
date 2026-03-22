import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCommonJsWithMocks } from './loadCommonJsWithMocks.mjs';

function createDecisionConfig(overrides = {}) {
  return {
    serviceName: 'detect-fraud',
    kafka: {
      flaggedTopic: 'transaction.flagged',
      finalisedTopic: 'transaction.finalised',
    },
    decision: {
      outsystemsUrl: null,
      timeoutMs: 5000,
      localFallbackEnabled: true,
      thresholds: {
        approveMax: 49,
        flagMin: 50,
        flagMax: 79,
        declineMin: 80,
        rulesFlaggedAutoDecline: false,
        certaintyAutoDeclineEnabled: false,
        certaintyDeclineMinScore: 70,
        certaintyDeclineMinConfidence: 0.9,
        highConfidenceApprove: 0.95,
        lowConfidenceFlag: 0.6,
        highValueAmount: 10000,
        highValueAutoFlag: false,
      },
      businessRules: {
        autoApproveWhitelist: [],
        autoDeclineBlacklist: [],
        requireManualReviewCountries: [],
      },
    },
    ...overrides,
  };
}

test('decision publisher auto-approves whitelisted customers', async () => {
  const sends = [];
  const decisionPublisher = loadCommonJsWithMocks(
    './services/detect_fraud/src/services/decisionPublisher.js',
    {
      axios: { post: async () => ({ status: 204, data: {} }) },
      kafkajs: { CompressionTypes: { GZIP: 'gzip' } },
      '../config': createDecisionConfig({
        decision: {
          ...createDecisionConfig().decision,
          businessRules: {
            autoApproveWhitelist: ['vip-customer'],
            autoDeclineBlacklist: [],
            requireManualReviewCountries: [],
          },
        },
      }),
      '../config/logger': {
        info: () => {},
        warn: () => {},
      },
    }
  );

  await decisionPublisher.process({
    producer: {
      send: async (payload) => {
        sends.push(payload);
      },
    },
    transaction: {
      id: 'txn-whitelist-1',
      customerId: 'vip-customer',
      merchantId: 'merchant-1',
      amount: 8500,
    },
    fraudAnalysis: {
      customerId: 'vip-customer',
      riskScore: 92,
      mlResults: {
        confidence: 0.99,
      },
    },
    correlationId: 'corr-whitelist-1',
  });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].topic, 'transaction.finalised');

  const publishedPayload = JSON.parse(sends[0].messages[0].value);
  assert.equal(publishedPayload.decision, 'APPROVED');
  assert.equal(publishedPayload.decisionSource, 'local-default');
  assert.equal(publishedPayload.overrideApplied, true);
  assert.equal(publishedPayload.overrideType, 'WHITELIST');
  assert.equal(publishedPayload.data.outcome, 'APPROVED');
});

test('decision publisher flags borderline transactions when low confidence adds risk', async () => {
  const sends = [];
  const decisionPublisher = loadCommonJsWithMocks(
    './services/detect_fraud/src/services/decisionPublisher.js',
    {
      axios: { post: async () => ({ status: 204, data: {} }) },
      kafkajs: { CompressionTypes: { GZIP: 'gzip' } },
      '../config': createDecisionConfig(),
      '../config/logger': {
        info: () => {},
        warn: () => {},
      },
    }
  );

  await decisionPublisher.process({
    producer: {
      send: async (payload) => {
        sends.push(payload);
      },
    },
    transaction: {
      id: 'txn-confidence-1',
      customerId: 'customer-123',
      merchantId: 'merchant-2',
      amount: 120,
    },
    fraudAnalysis: {
      customerId: 'customer-123',
      riskScore: 45,
      mlResults: {
        confidence: 0.5,
      },
    },
    correlationId: 'corr-confidence-1',
  });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].topic, 'transaction.flagged');

  const publishedPayload = JSON.parse(sends[0].messages[0].value);
  assert.equal(publishedPayload.decision, 'FLAGGED');
  assert.equal(publishedPayload.decisionFactors.confidenceAdjustment.adjustment, 10);
  assert.equal(publishedPayload.decisionFactors.adjustedScore, 55);
});

test('decision publisher fails closed when external handoff fails and fallback is disabled', async () => {
  let sendCalled = false;
  const decisionPublisher = loadCommonJsWithMocks(
    './services/detect_fraud/src/services/decisionPublisher.js',
    {
      axios: {
        post: async () => {
          throw new Error('outsystems unavailable');
        },
      },
      kafkajs: { CompressionTypes: { GZIP: 'gzip' } },
      '../config': createDecisionConfig({
        decision: {
          ...createDecisionConfig().decision,
          outsystemsUrl: 'http://outsystems.example.local/decision',
          localFallbackEnabled: false,
        },
      }),
      '../config/logger': {
        info: () => {},
        warn: () => {},
      },
    }
  );

  await assert.rejects(
    () => decisionPublisher.process({
      producer: {
        send: async () => {
          sendCalled = true;
        },
      },
      transaction: {
        id: 'txn-no-fallback-1',
        customerId: 'customer-456',
        merchantId: 'merchant-3',
        amount: 250,
      },
      fraudAnalysis: {
        customerId: 'customer-456',
        riskScore: 61,
        mlResults: {
          confidence: 0.91,
        },
      },
      correlationId: 'corr-no-fallback-1',
    }),
    /Decision handoff failed for transaction txn-no-fallback-1/
  );

  assert.equal(sendCalled, false);
});

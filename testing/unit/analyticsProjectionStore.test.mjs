import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCommonJsWithMocks } from './loadCommonJsWithMocks.mjs';

function createMemoryRedis() {
  const strings = new Map();
  const sets = new Map();

  const addToSet = (key, value) => {
    if (!sets.has(key)) {
      sets.set(key, new Set());
    }
    sets.get(key).add(value);
  };

  return {
    mode: 'memory',
    async get(key) {
      return strings.has(key) ? strings.get(key) : null;
    },
    async sCard(key) {
      return sets.has(key) ? sets.get(key).size : 0;
    },
    async sMembers(key) {
      return sets.has(key) ? [...sets.get(key)] : [];
    },
    multi() {
      const operations = [];

      return {
        sAdd(key, value) {
          operations.push(() => {
            addToSet(key, value);
            return 1;
          });
          return this;
        },
        set(key, value) {
          operations.push(() => {
            strings.set(key, value);
            return 'OK';
          });
          return this;
        },
        get(key) {
          operations.push(() => (strings.has(key) ? strings.get(key) : null));
          return this;
        },
        async exec() {
          return operations.map((operation) => operation());
        },
      };
    },
  };
}

function loadProjectionStore() {
  const redis = createMemoryRedis();
  const store = loadCommonJsWithMocks(
    './services/analytics/src/services/projectionStore.js',
    {
      '../config': {
        analytics: {
          projectionPrefix: 'analytics-test',
        },
      },
      '../config/redis': {
        getClient: () => redis,
      },
      '../config/logger': {
        warn: () => {},
      },
    }
  );

  return { store, redis };
}

test('analytics projections keep newer manual-review decisions when older events arrive later', async () => {
  const { store } = loadProjectionStore();

  await store.upsertDecisionEvent({
    eventType: 'transaction.flagged',
    transactionId: 'txn-analytics-1',
    customerId: 'customer-1',
    merchantId: 'merchant-1',
    decision: 'FLAGGED',
    decisionReason: 'Initial flag',
    originalTransaction: {
      customerId: 'customer-1',
      merchantId: 'merchant-1',
      amount: 100,
      currency: 'SGD',
      location: { country: 'SG' },
    },
    fraudAnalysis: {
      riskScore: 72,
      mlResults: { confidence: 0.81, score: 0.72 },
      ruleResults: { ruleScore: 65 },
      flagged: true,
    },
    decidedAt: '2026-03-22T10:00:00.000Z',
  });

  await store.applyManualReview({
    eventType: 'transaction.reviewed',
    transactionId: 'txn-analytics-1',
    reviewDecision: 'APPROVED',
    reviewedBy: 'analyst-1',
    reviewNotes: 'Customer confirmed the transfer',
    reviewedAt: '2026-03-22T10:05:00.000Z',
  });

  await store.upsertDecisionEvent({
    eventType: 'transaction.finalised',
    transactionId: 'txn-analytics-1',
    decision: 'DECLINED',
    decisionReason: 'Late stale event',
    fraudAnalysis: {
      riskScore: 95,
    },
    decidedAt: '2026-03-22T10:02:00.000Z',
  });

  const record = await store.getTransactionById('txn-analytics-1');

  assert.equal(record.decision, 'APPROVED');
  assert.equal(record.manualReview.reviewDecision, 'APPROVED');
  assert.equal(record.stateUpdatedAt, '2026-03-22T10:05:00.000Z');
  assert.equal(record.overrideType, 'MANUAL_REVIEW');
});

test('analytics projections apply appeal reversals back onto the linked transaction snapshot', async () => {
  const { store } = loadProjectionStore();

  await store.upsertDecisionEvent({
    eventType: 'transaction.finalised',
    transactionId: 'txn-analytics-2',
    customerId: 'customer-2',
    merchantId: 'merchant-2',
    decision: 'DECLINED',
    decisionReason: 'Fraud declined',
    originalTransaction: {
      customerId: 'customer-2',
      merchantId: 'merchant-2',
      amount: 210,
      currency: 'SGD',
      location: { country: 'SG' },
    },
    fraudAnalysis: {
      riskScore: 88,
      mlResults: { confidence: 0.94, score: 0.88 },
      ruleResults: { ruleScore: 83 },
      flagged: true,
    },
    decidedAt: '2026-03-22T11:00:00.000Z',
  });

  await store.upsertAppealCreated({
    eventType: 'appeal.created',
    appealId: 'appeal-1',
    transactionId: 'txn-analytics-2',
    customerId: 'customer-2',
    appealReason: 'This was a legitimate transaction',
    createdAt: '2026-03-22T11:10:00.000Z',
  });

  await store.upsertAppealResolved({
    eventType: 'appeal.resolved',
    appealId: 'appeal-1',
    transactionId: 'txn-analytics-2',
    resolution: 'REVERSE',
    reviewedBy: 'manager-1',
    resolutionNotes: 'Appeal accepted after investigation',
    resolvedAt: '2026-03-22T11:20:00.000Z',
  });

  const appeal = await store.getAppealById('appeal-1');
  const transaction = await store.getTransactionById('txn-analytics-2');

  assert.equal(appeal.currentStatus, 'RESOLVED');
  assert.equal(appeal.resolution, 'REVERSE');
  assert.equal(transaction.decision, 'APPROVED');
  assert.equal(transaction.overrideType, 'APPEAL_REVERSED');
  assert.equal(transaction.decisionFactors.appealResolution.resolution, 'REVERSE');
  assert.equal(transaction.decisionReason, 'Appeal resolved: REVERSE');
});

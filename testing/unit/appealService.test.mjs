import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCommonJsWithMocks } from './loadCommonJsWithMocks.mjs';

function loadAppealService({ existingAppeal = null, createAppealError = null } = {}) {
  const fetchCalls = [];
  const publishCalls = [];

  const service = loadCommonJsWithMocks(
    './services/appeal/src/services/appealService.js',
    {
      uuid: {
        v4: () => 'generated-correlation-id',
      },
      axios: {
        get: async (...args) => {
          fetchCalls.push(args);
          return {
            status: 200,
            data: {
              transactionId: 'txn-1',
              customerId: 'customer-1',
              status: 'REJECTED',
              correlationId: 'txn-correlation-id',
            },
          };
        },
      },
      '../config': {
        serviceName: 'appeal',
        transactionServiceUrl: 'http://transaction-service',
        kafka: {
          outputTopicCreated: 'appeal.created',
          outputTopicResolved: 'appeal.resolved',
        },
      },
      '../config/logger': {
        info: () => {},
        error: () => {},
      },
      '../config/kafka': {
        publish: async (...args) => {
          publishCalls.push(args);
        },
      },
      '../repositories/appealRepository': {
        getAnyByTransaction: async () => existingAppeal,
        createAppeal: async () => {
          if (createAppealError) {
            throw createAppealError;
          }

          return {
            appealId: 'appeal-1',
            transactionId: 'txn-1',
            customerId: 'customer-1',
            sourceTransactionStatus: 'REJECTED',
            appealReason: 'This decision should be reviewed again.',
            evidence: {},
            currentStatus: 'OPEN',
            createdAt: '2026-04-04T00:00:00.000Z',
            correlationId: 'generated-correlation-id',
          };
        },
      },
    }
  );

  service.setProducer({ producer: 'mock' });
  return { service, fetchCalls, publishCalls };
}

test('appeal service blocks a second appeal before revalidating the transaction', async () => {
  const { service, fetchCalls, publishCalls } = loadAppealService({
    existingAppeal: {
      appealId: 'appeal-existing',
      transactionId: 'txn-1',
      customerId: 'customer-1',
    },
  });

  await assert.rejects(
    service.createAppeal({
      transactionId: 'txn-1',
      customerId: 'customer-1',
      appealReason: 'This decision should be reviewed again.',
      evidence: {},
      correlationId: 'corr-1',
      authHeader: 'Bearer token',
    }),
    /already been appealed/
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(publishCalls.length, 0);
});

test('appeal service normalizes duplicate writes into the one-time appeal error', async () => {
  const { service, fetchCalls, publishCalls } = loadAppealService({
    createAppealError: new Error('duplicate key value violates unique constraint "appeals_transaction_id_key"'),
  });

  await assert.rejects(
    service.createAppeal({
      transactionId: 'txn-1',
      customerId: 'customer-1',
      appealReason: 'This decision should be reviewed again.',
      evidence: {},
      correlationId: 'corr-1',
      authHeader: 'Bearer token',
    }),
    /already been appealed/
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(publishCalls.length, 0);
});

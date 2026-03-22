import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCommonJsWithMocks } from './loadCommonJsWithMocks.mjs';

function loadTransactionService({ repositoryOverrides = {}, publishImpl } = {}) {
  const repository = {
    findByIdempotencyKey: async () => null,
    markOutboundEventPublished: async (transactionId) => ({ transaction_id: transactionId, outbound_event_published_at: '2026-03-22T00:00:00.000Z' }),
    markOutboundEventFailed: async () => undefined,
    findById: async (transactionId) => ({ transaction_id: transactionId }),
    create: async () => {
      throw new Error('create should be mocked in this test');
    },
    ...repositoryOverrides,
  };

  const publishCalls = [];
  const publish = async (...args) => {
    publishCalls.push(args);
    if (publishImpl) {
      return publishImpl(...args);
    }
    return undefined;
  };

  const service = loadCommonJsWithMocks(
    './services/transaction/src/services/transactionService.js',
    {
      '../repositories/transactionRepository': repository,
      '../kafka/producer': { publish },
      '../config': {
        kafka: {
          topics: {
            transactionCreated: 'transaction.created',
          },
        },
      },
      '../utils/constants': {
        TRANSACTION_STATUS: {
          PENDING: 'PENDING',
        },
      },
      '../utils/errors': {
        NotFoundError: class NotFoundError extends Error {},
      },
    }
  );

  return { service, repository, publishCalls };
}

test('transaction service republishes an unpublished idempotent transaction before returning it', async () => {
  const existing = {
    transaction_id: 'txn-replay-1',
    customer_id: 'customer-1',
    merchant_id: 'merchant-1',
    amount: '44.25',
    currency: 'SGD',
    card_type: 'DEBIT',
    country: 'SG',
    sender_name: 'Alice',
    recipient_customer_id: 'customer-2',
    recipient_name: 'Bob',
    hour_utc: 12,
    created_at: '2026-03-22T01:00:00.000Z',
    outbound_event_published_at: null,
    correlation_id: 'corr-existing-1',
  };

  const { service, repository, publishCalls } = loadTransactionService({
    repositoryOverrides: {
      findByIdempotencyKey: async () => existing,
      markOutboundEventPublished: async (transactionId) => ({
        transaction_id: transactionId,
        outbound_event_published_at: '2026-03-22T01:01:00.000Z',
      }),
    },
  });

  const result = await service.createTransaction(
    { customerId: existing.customer_id, amount: Number(existing.amount) },
    { idempotencyKey: 'idem-1', correlationId: 'corr-request-1', requestId: 'req-1' }
  );

  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0][0], 'transaction.created');
  assert.equal(publishCalls[0][1], 'customer-1');
  assert.equal(publishCalls[0][2].transactionId, 'txn-replay-1');
  assert.equal(publishCalls[0][2].eventType, 'transaction.created');
  assert.deepEqual(result, {
    transaction_id: 'txn-replay-1',
    outbound_event_published_at: '2026-03-22T01:01:00.000Z',
  });
  assert.equal(typeof repository.markOutboundEventFailed, 'function');
});

test('transaction service marks outbound publish failure for new transactions', async () => {
  const created = {
    transaction_id: 'txn-create-1',
    customer_id: 'customer-3',
    merchant_id: 'FTDS_TRANSFER',
    amount: '120.00',
    currency: 'SGD',
    card_type: 'CREDIT',
    country: 'SG',
    sender_name: 'Chris',
    recipient_customer_id: 'customer-4',
    recipient_name: 'Dana',
    hour_utc: 3,
    created_at: '2026-03-22T02:00:00.000Z',
  };

  const markFailures = [];
  const failure = new Error('kafka unavailable');
  const { service, publishCalls } = loadTransactionService({
    repositoryOverrides: {
      create: async () => created,
      markOutboundEventFailed: async (transactionId, reason) => {
        markFailures.push({ transactionId, reason });
      },
    },
    publishImpl: async () => {
      throw failure;
    },
  });

  await assert.rejects(
    () => service.createTransaction(
      {
        customerId: 'customer-3',
        senderName: 'Chris',
        recipientCustomerId: 'customer-4',
        recipientName: 'Dana',
        amount: 120,
      },
      { idempotencyKey: null, correlationId: 'corr-create-1', requestId: 'req-create-1' }
    ),
    /kafka unavailable/
  );

  assert.equal(publishCalls.length, 1);
  assert.deepEqual(markFailures, [
    {
      transactionId: 'txn-create-1',
      reason: 'kafka unavailable',
    },
  ]);
});

test('transaction service returns the canonical stored row for already-published idempotent requests', async () => {
  const canonicalRecord = {
    transaction_id: 'txn-idempotent-1',
    status: 'FLAGGED',
    fraud_score: 68,
  };

  const { service, publishCalls } = loadTransactionService({
    repositoryOverrides: {
      findByIdempotencyKey: async () => ({
        transaction_id: 'txn-idempotent-1',
        outbound_event_published_at: '2026-03-22T03:00:00.000Z',
      }),
      findById: async () => canonicalRecord,
    },
  });

  const result = await service.createTransaction(
    { customerId: 'customer-5', amount: 88 },
    { idempotencyKey: 'idem-2', correlationId: 'corr-idempotent-1', requestId: 'req-idempotent-1' }
  );

  assert.equal(publishCalls.length, 0);
  assert.deepEqual(result, canonicalRecord);
});

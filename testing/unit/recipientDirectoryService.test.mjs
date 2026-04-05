import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCommonJsWithMocks } from './loadCommonJsWithMocks.mjs';

function loadRecipientDirectoryService({ routeEnabled = true, responses = [] } = {}) {
  const calls = [];

  const recipientDirectoryService = loadCommonJsWithMocks(
    './services/gateway/src/services/recipientDirectoryService.js',
    {
      axios: async (requestConfig) => {
        calls.push(requestConfig);
        return responses.shift() || { status: 200, data: {} };
      },
      '../config': {
        recipientDirectory: {
          baseUrl: 'https://outsystems.example.com/Recipient/rest/Recipient',
          apiKey: 'top-secret-key',
          timeoutMs: 4321,
        },
        routeToggles: {
          recipientDirectory: routeEnabled,
        },
      },
    },
  );

  return { recipientDirectoryService, calls };
}

test('recipient directory list uses the external header names and normalizes favourites', async () => {
  const { recipientDirectoryService, calls } = loadRecipientDirectoryService({
    responses: [
      {
        status: 200,
        data: {
          data: {
            recipients: [
              {
                recipient_id: '7',
                owner_customer_id: 'cust-1',
                recipient_customer_id: 'cust-2',
                recipient_name: 'Nicole Goh',
                recipient_email: 'nicole@example.com',
                nickname: 'Nicole',
                is_favourite: true,
                is_active: true,
              },
            ],
          },
        },
      },
    ],
  });

  const result = await recipientDirectoryService.listRecipients('cust-1', true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://outsystems.example.com/Recipient/rest/Recipient/Recipients/');
  assert.deepEqual(calls[0].params, { favorites_only: true });
  assert.equal(calls[0].headers['X-Internal-Api-Key'], 'top-secret-key');
  assert.equal(calls[0].headers['X-User-ID'], 'cust-1');
  assert.equal(calls[0].timeout, 4321);
  assert.deepEqual(result, {
    status: 200,
    data: [
      {
        recipient_id: '7',
        owner_customer_id: 'cust-1',
        recipient_customer_id: 'cust-2',
        recipient_name: 'Nicole Goh',
        recipient_email: 'nicole@example.com',
        nickname: 'Nicole',
        is_favorite: true,
        is_active: true,
        created_on: null,
        updated_on: null,
      },
    ],
  });
});

test('recipient directory create maps UI favorite fields into the OutSystems request body', async () => {
  const { recipientDirectoryService, calls } = loadRecipientDirectoryService({
    responses: [
      {
        status: 200,
        data: {
          data: {
            recipient_id: '11',
            owner_customer_id: 'cust-1',
            recipient_customer_id: 'cust-2',
            recipient_name: 'Nicole Goh',
            recipient_email: 'nicole@example.com',
            nickname: 'Payroll',
            is_favourite: false,
            is_active: true,
          },
        },
      },
    ],
  });

  const result = await recipientDirectoryService.createRecipient('cust-1', {
    recipient_customer_id: 'cust-2',
    recipient_name: 'Nicole Goh',
    recipient_email: 'nicole@example.com',
    nickname: 'Payroll',
    is_favorite: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://outsystems.example.com/Recipient/rest/Recipient/recipients/');
  assert.deepEqual(calls[0].data, {
    recipient_customer_id: 'cust-2',
    recipient_name: 'Nicole Goh',
    recipient_email: 'nicole@example.com',
    nickname: 'Payroll',
    is_favourite: false,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.recipient_id, '11');
  assert.equal(result.data.is_favorite, false);
});

test('recipient directory service reports disabled state when the route toggle is off', async () => {
  const { recipientDirectoryService } = loadRecipientDirectoryService({ routeEnabled: false });
  assert.equal(recipientDirectoryService.isConfigured(), false);
});

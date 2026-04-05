import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  assertArrayContains,
  assertStatus,
  authHeaders,
  credentials,
  logStep,
  makeCustomer,
  platform,
  poll,
  request,
  staffLogin,
  waitForConsumerGroupsSettled,
  waitForLatestOtp,
  waitForStack,
} from './helpers.mjs';

const journeyCustomerSeed = makeCustomer('journey-customer');

const registerCustomer = async (customer) => {
  const result = await request(`${platform.publicBase}/api/auth/register`, {
    method: 'POST',
    body: customer,
  });

  assertStatus(result, [200, 201], `register ${customer.email}`);
  assert.equal(result.body?.requires_otp, true, `register ${customer.email} should require OTP`);
  return {
    ...customer,
  };
};

const verifyOtp = async (customer, otpCode) => {
  const result = await request(`${platform.publicBase}/api/auth/verify-otp`, {
    method: 'POST',
    body: {
      email: customer.email,
      otp_code: otpCode,
    },
  });

  assertStatus(result, 200, `public verify otp ${customer.email}`);
  return {
    ...customer,
    token: result.body.access_token,
    customerId: result.body.customer.customer_id,
  };
};

const createTransaction = async (customer, overrides) => {
  const result = await request(`${platform.publicBase}/api/customer/transactions`, {
    method: 'POST',
    headers: authHeaders(customer.token, {
      'X-Idempotency-Key': crypto.randomUUID(),
    }),
    body: {
      customer_id: customer.customerId,
      sender_name: customer.full_name,
      ...overrides,
    },
  });

  assertStatus(result, 201, `create transaction for ${customer.email}`);
  assert.ok(result.body?.transaction_id, 'transaction creation should return transaction_id');
  return result.body.transaction_id;
};

const getCustomerDecision = async (token, transactionId) => {
  const result = await request(`${platform.publicBase}/api/customer/transactions/${transactionId}/decision`, {
    headers: authHeaders(token),
  });
  assertStatus(result, 200, `customer decision lookup ${transactionId}`);
  return result;
};

const waitForTransactionStatus = async (token, transactionId, expectedStatus) => poll(
  `transaction ${transactionId} -> ${expectedStatus}`,
  () => getCustomerDecision(token, transactionId),
  (result) => String(result.body?.status || '').toUpperCase() === expectedStatus,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const listCustomerTransactions = async (customer) => {
  const result = await request(
    `${platform.publicBase}/api/customer/transactions?customer_id=${encodeURIComponent(customer.customerId)}&direction=all`,
    { headers: authHeaders(customer.token) }
  );
  assertStatus(result, 200, 'customer transaction list');
  assert.ok(Array.isArray(result.body), 'customer transaction list should return an array');
  return result.body;
};

const getManagerDashboard = async (managerSession) => {
  const result = await request(`${platform.publicBase}/api/analytics/dashboard`, {
    headers: authHeaders(managerSession.token),
  });
  assertStatus(result, 200, 'manager dashboard');
  return result.body;
};

await waitForStack();

logStep('Registering and verifying a fresh customer for the full platform journey');
let journeyCustomer = await registerCustomer(journeyCustomerSeed);
journeyCustomer = await verifyOtp(journeyCustomer, await waitForLatestOtp(journeyCustomer.email));

logStep('Signing in analyst and manager roles');
const analystSession = await staffLogin(credentials.analyst);
const managerSession = await staffLogin(credentials.manager);

logStep('Capturing dashboard baseline and probing direct fraud-score scoring');
const baselineDashboard = await getManagerDashboard(managerSession);
assertStatus(await request(`${platform.notificationBase}/api/v1/health/ready`), 200, 'notification readiness');
assertStatus(await request(`${platform.fraudScoreBase}/api/v1/score`, {
  method: 'POST',
  body: {
    transaction: {
      amount: 3200,
      currency: 'USD',
      cardType: 'PREPAID',
      location: { country: 'NG' },
      createdAt: new Date().toISOString(),
    },
    ruleResults: {
      riskFactors: {
        velocity: { countLastHour: 2 },
        geography: { highRiskCountry: true },
      },
    },
  },
}), 200, 'fraud score probe');

logStep('Creating a low-risk merchant payment and waiting for approval');
const approvedTransactionId = await createTransaction(journeyCustomer, {
  merchant_id: 'FTDS_NORMAL_DEMO',
  amount: 120.5,
  currency: 'SGD',
  card_type: 'CREDIT',
  country: 'SG',
});
const approvedDecision = await waitForTransactionStatus(journeyCustomer.token, approvedTransactionId, 'APPROVED');
assert.equal(String(approvedDecision.body?.status || '').toUpperCase(), 'APPROVED', 'approved transaction should be approved');

logStep('Creating a medium-risk transaction, then exercising claim and release while keeping it flagged');
const flaggedTransactionId = await createTransaction(journeyCustomer, {
  merchant_id: 'FTDS_FLAGGED_DEMO',
  amount: 5200,
  currency: 'USD',
  card_type: 'PREPAID',
  country: 'NG',
});
await waitForTransactionStatus(journeyCustomer.token, flaggedTransactionId, 'FLAGGED');

const flaggedQueue = await poll(
  'modern review queue contains the standalone flagged transaction',
  () => request(`${platform.publicBase}/api/v1/review-cases?status=PENDING,IN_REVIEW&limit=50&offset=0`, {
    headers: authHeaders(analystSession.token),
  }),
  (result) => result.status === 200
    && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.transactionId === flaggedTransactionId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(flaggedQueue.body?.data, (item) => item.transactionId === flaggedTransactionId, 'review queue should include standalone flagged transaction');

assertStatus(await request(`${platform.publicBase}/api/v1/review-cases/${flaggedTransactionId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
}), 200, 'claim standalone flagged transaction');

assertStatus(await request(`${platform.publicBase}/api/v1/review-cases/${flaggedTransactionId}/release`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { notes: 'Released during automated flagged-case coverage.' },
}), 200, 'release standalone flagged transaction');

await waitForTransactionStatus(journeyCustomer.token, flaggedTransactionId, 'FLAGGED');

logStep('Creating a high-risk transaction and waiting for automatic decline');
const declinedTransactionId = await createTransaction(journeyCustomer, {
  merchant_id: 'FTDS_DECLINED_DEMO',
  amount: 15000,
  currency: 'USD',
  card_type: 'PREPAID',
  country: 'NG',
});
const declinedDecision = await waitForTransactionStatus(journeyCustomer.token, declinedTransactionId, 'REJECTED');
assert.equal(String(declinedDecision.body?.status || '').toUpperCase(), 'REJECTED', 'declined transaction should be rejected');

logStep('Checking customer-visible listings, audit trail, analytics, and settled consumers');
const customerTransactions = await listCustomerTransactions(journeyCustomer);
assertArrayContains(customerTransactions, (item) => item.transaction_id === approvedTransactionId && item.status === 'APPROVED', 'customer transactions should include approved journey transaction');
assertArrayContains(customerTransactions, (item) => item.transaction_id === flaggedTransactionId && item.status === 'FLAGGED', 'customer transactions should include standalone flagged journey transaction');
assertArrayContains(customerTransactions, (item) => item.transaction_id === declinedTransactionId && item.status === 'REJECTED', 'customer transactions should include declined journey transaction');

const auditTrailResult = await poll(
  'audit trail recorded finalisation for the declined transaction',
  () => request(`${platform.auditBase}/api/v1/audit/transaction/${declinedTransactionId}`),
  (result) => result.status === 200
    && Number(result.body?.data?.eventCount) > 0
    && Array.isArray(result.body?.data?.events)
    && result.body.data.events.some((item) => item.eventType === 'transaction.finalised'),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const finalDashboard = await poll(
  'manager dashboard reflects the approved, flagged, and declined outcomes',
  () => getManagerDashboard(managerSession),
  (dashboard) => Number(dashboard.transactions_approved || 0) >= Number(baselineDashboard.transactions_approved || 0) + 1
    && Number(dashboard.transactions_flagged || 0) >= Number(baselineDashboard.transactions_flagged || 0) + 1
    && Number(dashboard.transactions_rejected || 0) >= Number(baselineDashboard.transactions_rejected || 0) + 1,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const settledConsumerGroups = await waitForConsumerGroupsSettled();

logStep('Full platform journey completed successfully');
console.log(JSON.stringify({
  customer: {
    email: journeyCustomer.email,
    customerId: journeyCustomer.customerId,
  },
  staff: {
    analyst: analystSession.user,
    manager: managerSession.user,
  },
  transactions: {
    approved: approvedTransactionId,
    flagged: flaggedTransactionId,
    declined: declinedTransactionId,
  },
  dashboard: {
    baseline: baselineDashboard,
    final: finalDashboard,
  },
  auditEventCount: auditTrailResult.body?.data?.eventCount,
  consumerGroups: Object.fromEntries(
    Object.entries(settledConsumerGroups).map(([group, details]) => [
      group,
      { state: details.state, totalLag: details.totalLag },
    ])
  ),
}, null, 2));

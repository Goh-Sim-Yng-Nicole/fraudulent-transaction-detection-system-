import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  assertStatus,
  authHeaders,
  credentials,
  logStep,
  makeCustomer,
  platform,
  poll,
  request,
  waitForStack,
} from './helpers.mjs';

const buildFlaggedTransactionPayload = ({
  customerId,
  senderName,
  recipientCustomerId,
  recipientName,
  amount,
}) => ({
  customer_id: customerId,
  sender_name: senderName,
  recipient_customer_id: recipientCustomerId,
  recipient_name: recipientName,
  amount,
  currency: 'USD',
  card_type: 'PREPAID',
  country: 'NG',
  merchant_id: 'FTDS_E2E_MERCHANT',
});

const expectArrayContains = (items, predicate, message) => {
  assert.ok(Array.isArray(items), `${message}: expected array payload`);
  assert.ok(items.some(predicate), message);
};

const firstCustomer = makeCustomer('primary-customer');
const secondCustomer = makeCustomer('recipient-customer');

const registerCustomer = async (customer) => {
  const result = await request(`${platform.publicBase}/api/auth/register`, {
    method: 'POST',
    body: customer,
  });

  assertStatus(result, 201, `register ${customer.email}`);
  assert.ok(result.body?.access_token, `register ${customer.email}: missing access token`);
  assert.ok(result.body?.customer?.customer_id, `register ${customer.email}: missing customer id`);

  return {
    ...customer,
    token: result.body.access_token,
    customerId: result.body.customer.customer_id,
  };
};

const getCustomerDecision = async (token, transactionId) => {
  const result = await request(`${platform.publicBase}/api/customer/transactions/${transactionId}/decision`, {
    headers: authHeaders(token),
  });
  assertStatus(result, 200, `customer decision lookup ${transactionId}`);
  return result;
};

const createFlaggedTransaction = async (customer, recipient, amount) => {
  const result = await request(`${platform.publicBase}/api/customer/transactions`, {
    method: 'POST',
    headers: authHeaders(customer.token, {
      'X-Idempotency-Key': crypto.randomUUID(),
    }),
    body: buildFlaggedTransactionPayload({
      customerId: customer.customerId,
      senderName: customer.full_name,
      recipientCustomerId: recipient.customerId,
      recipientName: recipient.full_name,
      amount,
    }),
  });

  assertStatus(result, 201, `create flagged transaction for ${customer.email}`);
  assert.ok(result.body?.transaction_id, 'create flagged transaction: missing transaction id');
  return result.body.transaction_id;
};

const waitForTransactionStatus = async (token, transactionId, expectedStatus) => poll(
  `transaction ${transactionId} -> ${expectedStatus}`,
  () => getCustomerDecision(token, transactionId),
  (result) => result.body?.status === expectedStatus,
  { timeoutMs: 120000, intervalMs: 2500 }
);

await waitForStack();

logStep('Registering customers through the public edge');
const customerA = await registerCustomer(firstCustomer);
const customerB = await registerCustomer(secondCustomer);

logStep('Exercising customer profile and OTP auth routes');
const meResult = await request(`${platform.publicBase}/api/customers/me`, {
  headers: authHeaders(customerA.token),
});
assertStatus(meResult, 200, 'customer profile');
assert.equal(meResult.body?.email, customerA.email, 'customer profile email mismatch');

const loginResult = await request(`${platform.publicBase}/api/auth/login`, {
  method: 'POST',
  body: {
    email: customerA.email,
    password: customerA.password,
  },
});
assertStatus(loginResult, 200, 'public login');
assert.equal(loginResult.body?.requires_otp, true, 'public login should require OTP');

const resendOtpResult = await request(`${platform.publicBase}/api/auth/resend-otp`, {
  method: 'POST',
  body: { email: customerA.email },
});
assertStatus(resendOtpResult, 200, 'resend otp');

logStep('Validating gateway modern auth proxy');
const gatewayLoginResult = await request(`${platform.gatewayBase}/api/v1/auth/login`, {
  method: 'POST',
  body: {
    email: customerA.email,
    password: customerA.password,
  },
});
assertStatus(gatewayLoginResult, 200, 'gateway modern auth login');
assert.equal(gatewayLoginResult.body?.requires_otp, true, 'gateway modern auth login should require OTP');

logStep('Checking customer lookup and direct fraud-score scoring');
const lookupResult = await request(
  `${platform.publicBase}/api/customers/lookup?query=${encodeURIComponent(customerB.email)}`,
  { headers: authHeaders(customerA.token) }
);
assertStatus(lookupResult, 200, 'customer lookup');
assert.equal(lookupResult.body?.customer_id, customerB.customerId, 'customer lookup returned unexpected recipient');

const fraudScoreProbe = await request(`${platform.fraudScoreBase}/api/v1/score`, {
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
        velocity: { countLastHour: 1 },
        geography: { highRiskCountry: true },
      },
    },
  },
});
assertStatus(fraudScoreProbe, 200, 'fraud score probe');
assert.equal(fraudScoreProbe.body?.success, true, 'fraud score probe should succeed');

logStep('Creating a flagged transaction and resolving it via analyst review');
const transactionOneId = await createFlaggedTransaction(customerA, customerB, 3200);
await waitForTransactionStatus(customerA.token, transactionOneId, 'FLAGGED');

const gatewayTransactionList = await request(
  `${platform.gatewayBase}/api/v1/transactions/customer/${customerA.customerId}?direction=all`,
  { headers: authHeaders(customerA.token) }
);
assertStatus(gatewayTransactionList, 200, 'gateway modern transactions list');
expectArrayContains(
  gatewayTransactionList.body,
  (item) => item.transaction_id === transactionOneId,
  'gateway modern transactions list should include the created transaction'
);

await poll(
  'customer decision endpoint reflects flagged status for transaction one',
  () => getCustomerDecision(customerA.token, transactionOneId),
  (result) => result.status === 200 && result.body?.status === 'FLAGGED' && Number.isFinite(Number(result.body?.fraud_score)),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const analystLogin = await request(`${platform.publicBase}/api/fraud-review/login`, {
  method: 'POST',
  body: credentials.analyst,
});
assertStatus(analystLogin, 200, 'analyst login');
const analystToken = analystLogin.body?.access_token;
assert.ok(analystToken, 'analyst login missing access token');

await poll(
  'flagged review queue contains transaction one',
  () => request(`${platform.publicBase}/api/fraud-review/flagged`, {
    headers: authHeaders(analystToken),
  }),
  (result) => result.status === 200 && Array.isArray(result.body)
    && result.body.some((item) => item.transaction_id === transactionOneId),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const resolveFlaggedResult = await request(
  `${platform.publicBase}/api/fraud-review/flagged/${transactionOneId}/resolve`,
  {
    method: 'POST',
    headers: authHeaders(analystToken),
    body: {
      manual_outcome: 'APPROVED',
      reason: 'Customer identity and transfer context verified',
    },
  }
);
assertStatus(resolveFlaggedResult, 200, 'resolve flagged transaction');
await waitForTransactionStatus(customerA.token, transactionOneId, 'APPROVED');

logStep('Creating a second flagged transaction and driving the appeal flow');
const transactionTwoId = await createFlaggedTransaction(customerA, customerB, 3300);
await waitForTransactionStatus(customerA.token, transactionTwoId, 'FLAGGED');

const appealCreateResult = await request(`${platform.publicBase}/api/customer/appeals`, {
  method: 'POST',
  headers: authHeaders(customerA.token),
  body: {
    transaction_id: transactionTwoId,
    customer_id: customerA.customerId,
    reason_for_appeal: 'Customer confirmed the recipient and can provide supporting evidence.',
    evidence: {
      source: 'e2e-test',
      note: 'Consistent transfer purpose confirmed by customer',
    },
  },
});
assertStatus(appealCreateResult, 200, 'create appeal');
const appealId = appealCreateResult.body?.appeal_id;
assert.ok(appealId, 'appeal creation missing appeal id');

const customerAppealsResult = await poll(
  'customer appeals list includes created appeal',
  () => request(
    `${platform.publicBase}/api/customer/appeals?customer_id=${encodeURIComponent(customerA.customerId)}`,
    { headers: authHeaders(customerA.token) }
  ),
  (result) => result.status === 200 && Array.isArray(result.body)
    && result.body.some((item) => item.appeal_id === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
expectArrayContains(
  customerAppealsResult.body,
  (item) => item.appeal_id === appealId,
  'customer appeals list should include the created appeal'
);

await poll(
  'analyst appeal queue contains created appeal',
  () => request(`${platform.publicBase}/api/fraud-review/appeals`, {
    headers: authHeaders(analystToken),
  }),
  (result) => result.status === 200 && Array.isArray(result.body)
    && result.body.some((item) => item.appeal_id === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const resolveAppealResult = await request(
  `${platform.publicBase}/api/fraud-review/appeals/${appealId}/resolve`,
  {
    method: 'POST',
    headers: authHeaders(analystToken),
    body: {
      manual_outcome: 'APPROVED',
      outcome_reason: 'Appeal evidence validated and transaction reinstated',
    },
  }
);
assertStatus(resolveAppealResult, 200, 'resolve appeal');
await waitForTransactionStatus(customerA.token, transactionTwoId, 'APPROVED');

await poll(
  'customer decision endpoint reflects approved appeal outcome',
  () => getCustomerDecision(customerA.token, transactionTwoId),
  (result) => result.status === 200 && result.body?.status === 'APPROVED',
  { timeoutMs: 120000, intervalMs: 2500 }
);

logStep('Checking manager analytics projections and audit trail');
const managerLogin = await request(`${platform.publicBase}/api/analytics/login`, {
  method: 'POST',
  body: credentials.manager,
});
assertStatus(managerLogin, 200, 'manager login');
const managerToken = managerLogin.body?.access_token;
assert.ok(managerToken, 'manager login missing access token');

const dashboardResult = await poll(
  'analytics dashboard reflects reviewed and appealed transactions',
  () => request(`${platform.publicBase}/api/analytics/dashboard`, {
    headers: authHeaders(managerToken),
  }),
  (result) => result.status === 200
    && Number(result.body?.transactions_approved) >= 2
    && Number(result.body?.appeals_created) >= 1
    && Number(result.body?.appeals_approved) >= 1,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const auditTrailResult = await poll(
  'audit trail recorded transaction events',
  () => request(`${platform.auditBase}/api/v1/audit/transaction/${transactionTwoId}`),
  (result) => result.status === 200 && Number(result.body?.data?.eventCount) > 0,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const notificationHealth = await request(`${platform.notificationBase}/api/v1/health/live`);
assertStatus(notificationHealth, 200, 'notification health');

logStep('End-to-end verification completed successfully');
console.log(JSON.stringify({
  customers: {
    primary: customerA.customerId,
    recipient: customerB.customerId,
  },
  transactions: {
    manuallyReviewedApproved: transactionOneId,
    appealApproved: transactionTwoId,
  },
  appealId,
  analytics: dashboardResult.body,
  auditEventCount: auditTrailResult.body?.data?.eventCount,
}, null, 2));

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

const firstCustomer = makeCustomer('primary-customer');
const secondCustomer = makeCustomer('recipient-customer');
const lifecycleCustomerSeed = makeCustomer('lifecycle-customer');

const registerCustomer = async (customer) => {
  const result = await request(`${platform.publicBase}/api/auth/register`, {
    method: 'POST',
    body: customer,
  });

  assertStatus(result, 201, `register ${customer.email}`);
  return {
    ...customer,
    token: result.body.access_token,
    customerId: result.body.customer.customer_id,
  };
};

const loginCustomer = async (customer, password = customer.password) => {
  const result = await request(`${platform.publicBase}/api/auth/login`, {
    method: 'POST',
    body: {
      email: customer.email,
      password,
    },
  });

  assertStatus(result, 200, `public login ${customer.email}`);
  assert.equal(result.body?.requires_otp, true, `public login ${customer.email} should require OTP`);
  return result;
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
  return result.body.transaction_id;
};

const waitForTransactionStatus = async (token, transactionId, expectedStatus) => poll(
  `transaction ${transactionId} -> ${expectedStatus}`,
  () => getCustomerDecision(token, transactionId),
  (result) => result.body?.status === expectedStatus,
  { timeoutMs: 120000, intervalMs: 2500 }
);

await waitForStack();

logStep('Registering disposable end-to-end customers');
let customerA = await registerCustomer(firstCustomer);
const customerB = await registerCustomer(secondCustomer);
let lifecycleCustomer = await registerCustomer(lifecycleCustomerSeed);

logStep('Completing OTP verification for the primary customer');
await loginCustomer(customerA);
const primaryOtp = await waitForLatestOtp(customerA.email);
customerA = await verifyOtp(customerA, primaryOtp);

const profileResult = await request(`${platform.publicBase}/api/customers/me`, {
  headers: authHeaders(customerA.token),
});
assertStatus(profileResult, 200, 'customer profile');
assert.equal(profileResult.body?.email, customerA.email, 'customer profile email mismatch');

const resendOtpResult = await request(`${platform.publicBase}/api/auth/resend-otp`, {
  method: 'POST',
  body: { email: customerA.email },
});
assertStatus(resendOtpResult, 200, 'resend otp');

logStep('Exercising password rotation with DB-backed OTP verification');
const requestSensitiveOtp = await request(`${platform.publicBase}/api/customers/me/request-otp`, {
  method: 'POST',
  headers: authHeaders(customerA.token),
});
assertStatus(requestSensitiveOtp, 200, 'request sensitive otp');

const passwordOtp = await waitForLatestOtp(customerA.email);
const rotatedPassword = `${customerA.password}-rotated`;
const changePasswordResult = await request(`${platform.publicBase}/api/customers/me/password`, {
  method: 'PUT',
  headers: authHeaders(customerA.token),
  body: {
    current_password: customerA.password,
    new_password: rotatedPassword,
    otp_code: passwordOtp,
  },
});
assertStatus(changePasswordResult, 200, 'change password');

assertStatus(await request(`${platform.publicBase}/api/auth/login`, {
  method: 'POST',
  body: { email: customerA.email, password: customerA.password },
}), 401, 'login with old password should fail');

await loginCustomer(customerA, rotatedPassword);
const rotatedLoginOtp = await waitForLatestOtp(customerA.email);
customerA = await verifyOtp({ ...customerA, password: rotatedPassword }, rotatedLoginOtp);
customerA.password = rotatedPassword;

logStep('Validating gateway modern auth proxy after password rotation');
const gatewayLoginResult = await request(`${platform.gatewayBase}/api/v1/auth/login`, {
  method: 'POST',
  body: {
    email: customerA.email,
    password: customerA.password,
  },
});
assertStatus(gatewayLoginResult, 200, 'gateway modern auth login');
assert.equal(gatewayLoginResult.body?.requires_otp, true, 'gateway modern auth login should require OTP');

logStep('Verifying lookup and lifecycle delete flows');
const lookupResult = await request(
  `${platform.publicBase}/api/customers/lookup?query=${encodeURIComponent(customerB.email)}`,
  { headers: authHeaders(customerA.token) }
);
assertStatus(lookupResult, 200, 'customer lookup');
assert.equal(lookupResult.body?.customer_id, customerB.customerId, 'customer lookup returned unexpected recipient');

await loginCustomer(lifecycleCustomer);
const lifecycleLoginOtp = await waitForLatestOtp(lifecycleCustomer.email);
lifecycleCustomer = await verifyOtp(lifecycleCustomer, lifecycleLoginOtp);

const lifecycleOtpRequest = await request(`${platform.publicBase}/api/customers/me/request-otp`, {
  method: 'POST',
  headers: authHeaders(lifecycleCustomer.token),
});
assertStatus(lifecycleOtpRequest, 200, 'lifecycle customer request otp');

const lifecycleDeleteOtp = await waitForLatestOtp(lifecycleCustomer.email);
const deleteLifecycleAccount = await request(`${platform.publicBase}/api/customers/me`, {
  method: 'DELETE',
  headers: authHeaders(lifecycleCustomer.token),
  body: {
    password: lifecycleCustomer.password,
    otp_code: lifecycleDeleteOtp,
  },
});
assertStatus(deleteLifecycleAccount, 200, 'delete lifecycle account');

assertStatus(await request(`${platform.publicBase}/api/auth/login`, {
  method: 'POST',
  body: { email: lifecycleCustomer.email, password: lifecycleCustomer.password },
}), 403, 'deleted account login should be forbidden');

assertStatus(await request(`${platform.publicBase}/api/customers/me`, {
  headers: authHeaders(lifecycleCustomer.token),
}), 401, 'deleted account token should no longer access profile');

logStep('Signing in staff roles for manual review and analytics');
const analystSession = await staffLogin(credentials.analyst);
const managerSession = await staffLogin(credentials.manager);

logStep('Checking direct fraud-score scoring');
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

logStep('Creating a flagged transaction and resolving it via the public legacy review workflow');
const transactionOneId = await createFlaggedTransaction(customerA, customerB, 3200);
await waitForTransactionStatus(customerA.token, transactionOneId, 'FLAGGED');

await poll(
  'public legacy flagged queue contains transaction one',
  () => request(`${platform.publicBase}/api/fraud-review/flagged`, {
    headers: authHeaders(analystSession.token),
  }),
  (result) => result.status === 200 && Array.isArray(result.body)
    && result.body.some((item) => item.transaction_id === transactionOneId),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const resolveFlaggedResult = await request(
  `${platform.publicBase}/api/fraud-review/flagged/${transactionOneId}/resolve`,
  {
    method: 'POST',
    headers: authHeaders(analystSession.token),
    body: {
      manual_outcome: 'APPROVED',
      reason: 'Customer identity and transfer context verified',
    },
  }
);
assertStatus(resolveFlaggedResult, 200, 'resolve flagged transaction');
await waitForTransactionStatus(customerA.token, transactionOneId, 'APPROVED');

logStep('Creating a second flagged transaction and resolving it through the modern review APIs');
const transactionTwoId = await createFlaggedTransaction(customerA, customerB, 3300);
await waitForTransactionStatus(customerA.token, transactionTwoId, 'FLAGGED');

const reviewCasesResult = await poll(
  'modern review cases include transaction two',
  () => request(`${platform.publicBase}/api/v1/review-cases?status=PENDING,IN_REVIEW`, {
    headers: authHeaders(analystSession.token),
  }),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.transactionId === transactionTwoId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(reviewCasesResult.body?.data, (item) => item.transactionId === transactionTwoId, 'modern review cases should include transaction two');

assertStatus(await request(`${platform.publicBase}/api/v1/review-cases/${transactionTwoId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
}), 200, 'claim modern review case');

assertStatus(await request(`${platform.publicBase}/api/v1/review-cases/${transactionTwoId}/release`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { notes: 'Releasing once to validate release flow' },
}), 200, 'release modern review case');

assertStatus(await request(`${platform.publicBase}/api/v1/review-cases/${transactionTwoId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
}), 200, 'reclaim modern review case');

const resolveModernReview = await request(`${platform.publicBase}/api/v1/reviews/${transactionTwoId}/decision`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: {
    decision: 'APPROVED',
    notes: 'Modern manual review completed successfully',
  },
});
assertStatus(resolveModernReview, 200, 'resolve modern review decision');
assert.equal(resolveModernReview.body?.data?.reviewedBy, analystSession.user.userId, 'modern review should record authenticated analyst');
await waitForTransactionStatus(customerA.token, transactionTwoId, 'APPROVED');

logStep('Creating a third flagged transaction and driving the appeal flow');
const transactionThreeId = await createFlaggedTransaction(customerA, customerB, 3400);
await waitForTransactionStatus(customerA.token, transactionThreeId, 'FLAGGED');

const appealCreateResult = await request(`${platform.publicBase}/api/customer/appeals`, {
  method: 'POST',
  headers: authHeaders(customerA.token),
  body: {
    transaction_id: transactionThreeId,
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

await poll(
  'customer appeals list includes created appeal',
  () => request(
    `${platform.publicBase}/api/customer/appeals?customer_id=${encodeURIComponent(customerA.customerId)}`,
    { headers: authHeaders(customerA.token) }
  ),
  (result) => result.status === 200 && Array.isArray(result.body)
    && result.body.some((item) => item.appeal_id === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);

await poll(
  'modern public appeal queue contains created appeal',
  () => request(`${platform.publicBase}/api/v1/reviews/appeals/pending?limit=50&offset=0`, {
    headers: authHeaders(analystSession.token),
  }),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.appealId === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);

assertStatus(await request(`${platform.publicBase}/api/v1/reviews/appeals/${appealId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
}), 200, 'claim appeal case');

assertStatus(await request(`${platform.publicBase}/api/v1/reviews/appeals/${appealId}/release`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { notes: 'Release once to validate ownership handling' },
}), 200, 'release appeal case');

assertStatus(await request(`${platform.publicBase}/api/v1/reviews/appeals/${appealId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
}), 200, 'reclaim appeal case');

const resolveAppealResult = await request(
  `${platform.publicBase}/api/v1/reviews/appeals/${appealId}/resolve`,
  {
    method: 'POST',
    headers: authHeaders(analystSession.token),
    body: {
      resolution: 'REVERSE',
      notes: 'Appeal evidence validated and transaction reinstated',
    },
  }
);
assertStatus(resolveAppealResult, 200, 'resolve appeal via modern review API');
assert.equal(resolveAppealResult.body?.data?.reviewedBy, analystSession.user.userId, 'appeal resolution should record authenticated analyst');
await waitForTransactionStatus(customerA.token, transactionThreeId, 'APPROVED');

logStep('Checking analytics, audit, notification, and consumer completion');
const dashboardResult = await poll(
  'public analytics dashboard reflects reviewed and appealed transactions',
  () => request(`${platform.publicBase}/api/analytics/dashboard`, {
    headers: authHeaders(managerSession.token),
  }),
  (result) => result.status === 200
    && Number(result.body?.transactions_approved) >= 3
    && Number(result.body?.appeals_created) >= 1
    && Number(result.body?.appeals_approved) >= 1,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const auditTrailResult = await poll(
  'audit trail recorded appeal transaction events',
  () => request(`${platform.auditBase}/api/v1/audit/transaction/${transactionThreeId}`),
  (result) => result.status === 200
    && Number(result.body?.data?.eventCount) > 0
    && Array.isArray(result.body?.data?.events)
    && result.body.data.events.some((item) => ['appeal.created', 'appeal.resolved', 'transaction.flagged', 'transaction.finalised'].includes(item.eventType)),
  { timeoutMs: 120000, intervalMs: 2500 }
);

assertStatus(await request(`${platform.notificationBase}/api/v1/health/ready`), 200, 'notification readiness');

const settledConsumerGroups = await waitForConsumerGroupsSettled();

logStep('End-to-end verification completed successfully');
console.log(JSON.stringify({
  staff: {
    analyst: analystSession.user,
    manager: managerSession.user,
  },
  customers: {
    primary: customerA.customerId,
    recipient: customerB.customerId,
    lifecycleDeleted: lifecycleCustomer.customerId,
  },
  transactions: {
    legacyReviewedApproved: transactionOneId,
    modernReviewedApproved: transactionTwoId,
    appealApproved: transactionThreeId,
  },
  appealId,
  analytics: dashboardResult.body,
  auditEventCount: auditTrailResult.body?.data?.eventCount,
  consumerGroups: Object.fromEntries(
    Object.entries(settledConsumerGroups).map(([group, details]) => [
      group,
      { state: details.state, totalLag: details.totalLag },
    ])
  ),
}, null, 2));

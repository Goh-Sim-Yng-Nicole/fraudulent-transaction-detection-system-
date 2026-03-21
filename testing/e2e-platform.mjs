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
  assert.ok(result.body?.access_token, `register ${customer.email}: missing access token`);
  assert.ok(result.body?.customer?.customer_id, `register ${customer.email}: missing customer id`);

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
  assert.ok(result.body?.access_token, `public verify otp ${customer.email}: missing access token`);

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

const loginWithOldPassword = await request(`${platform.publicBase}/api/auth/login`, {
  method: 'POST',
  body: {
    email: customerA.email,
    password: customerA.password,
  },
});
assertStatus(loginWithOldPassword, 401, 'login with old password should fail');

await loginCustomer(customerA, rotatedPassword);
const rotatedLoginOtp = await waitForLatestOtp(customerA.email);
customerA = await verifyOtp({
  ...customerA,
  password: rotatedPassword,
}, rotatedLoginOtp);
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

const deletedLoginAttempt = await request(`${platform.publicBase}/api/auth/login`, {
  method: 'POST',
  body: {
    email: lifecycleCustomer.email,
    password: lifecycleCustomer.password,
  },
});
assertStatus(deletedLoginAttempt, 403, 'deleted account login should be forbidden');

const deletedProfileAttempt = await request(`${platform.publicBase}/api/customers/me`, {
  headers: authHeaders(lifecycleCustomer.token),
});
assertStatus(deletedProfileAttempt, 401, 'deleted account token should no longer access profile');

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
assert.equal(fraudScoreProbe.body?.success, true, 'fraud score probe should succeed');

logStep('Creating a flagged transaction and resolving it via the legacy analyst workflow');
const transactionOneId = await createFlaggedTransaction(customerA, customerB, 3200);
await waitForTransactionStatus(customerA.token, transactionOneId, 'FLAGGED');

const gatewayTransactionList = await request(
  `${platform.gatewayBase}/api/v1/transactions/customer/${customerA.customerId}?direction=all`,
  { headers: authHeaders(customerA.token) }
);
assertStatus(gatewayTransactionList, 200, 'gateway modern transactions list');
assertArrayContains(
  gatewayTransactionList.body,
  (item) => item.transaction_id === transactionOneId,
  'gateway modern transactions list should include the first created transaction'
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
  'legacy flagged queue contains transaction one',
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

logStep('Creating a second flagged transaction and resolving it through the modern review APIs');
const transactionTwoId = await createFlaggedTransaction(customerA, customerB, 3300);
await waitForTransactionStatus(customerA.token, transactionTwoId, 'FLAGGED');

const reviewCasesResult = await poll(
  'modern review cases include transaction two',
  () => request(`${platform.fraudReviewBase}/api/v1/review-cases?status=PENDING,IN_REVIEW`),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.transactionId === transactionTwoId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(
  reviewCasesResult.body?.data,
  (item) => item.transactionId === transactionTwoId,
  'modern review cases should include transaction two'
);

const modernPendingReviews = await request(`${platform.fraudReviewBase}/api/v1/reviews/pending`);
assertStatus(modernPendingReviews, 200, 'modern pending reviews');
assertArrayContains(
  modernPendingReviews.body?.data,
  (item) => item.transactionId === transactionTwoId,
  'modern pending reviews should include transaction two'
);

const modernReviewRecord = await request(`${platform.fraudReviewBase}/api/v1/reviews/${transactionTwoId}`);
assertStatus(modernReviewRecord, 200, 'modern review record');
assert.equal(modernReviewRecord.body?.data?.transactionId, transactionTwoId, 'modern review record should match transaction two');

const claimModernReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${transactionTwoId}/claim`, {
  method: 'POST',
  body: {
    reviewerId: 'modern-e2e-analyst',
    claimTtlMinutes: 5,
  },
});
assertStatus(claimModernReview, 200, 'claim modern review case');

const releaseModernReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${transactionTwoId}/release`, {
  method: 'POST',
  body: {
    reviewerId: 'modern-e2e-analyst',
    notes: 'Releasing once to validate release flow',
  },
});
assertStatus(releaseModernReview, 200, 'release modern review case');

const reclaimModernReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${transactionTwoId}/claim`, {
  method: 'POST',
  body: {
    reviewerId: 'modern-e2e-analyst',
    claimTtlMinutes: 5,
  },
});
assertStatus(reclaimModernReview, 200, 'reclaim modern review case');

const resolveModernReview = await request(`${platform.fraudReviewBase}/api/v1/reviews/${transactionTwoId}/decision`, {
  method: 'POST',
  body: {
    decision: 'APPROVED',
    reviewedBy: 'modern-e2e-analyst',
    notes: 'Modern manual review completed successfully',
  },
});
assertStatus(resolveModernReview, 200, 'resolve modern review decision');
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
assertArrayContains(
  customerAppealsResult.body,
  (item) => item.appeal_id === appealId,
  'customer appeals list should include the created appeal'
);

await poll(
  'legacy analyst appeal queue contains created appeal',
  () => request(`${platform.publicBase}/api/fraud-review/appeals`, {
    headers: authHeaders(analystToken),
  }),
  (result) => result.status === 200 && Array.isArray(result.body)
    && result.body.some((item) => item.appeal_id === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const modernPendingAppeals = await poll(
  'modern appeal queue contains created appeal',
  () => request(`${platform.fraudReviewBase}/api/v1/reviews/appeals/pending`),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.appealId === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(
  modernPendingAppeals.body?.data,
  (item) => item.appealId === appealId,
  'modern appeal queue should include the created appeal'
);

const resolveAppealResult = await request(
  `${platform.fraudReviewBase}/api/v1/reviews/appeals/${appealId}/resolve`,
  {
    method: 'POST',
    body: {
      resolution: 'REVERSE',
      reviewedBy: 'appeal-e2e-analyst',
      notes: 'Appeal evidence validated and transaction reinstated',
    },
  }
);
assertStatus(resolveAppealResult, 200, 'resolve appeal via modern review API');
await waitForTransactionStatus(customerA.token, transactionThreeId, 'APPROVED');

await poll(
  'customer decision endpoint reflects approved appeal outcome',
  () => getCustomerDecision(customerA.token, transactionThreeId),
  (result) => result.status === 200 && result.body?.status === 'APPROVED',
  { timeoutMs: 120000, intervalMs: 2500 }
);

logStep('Checking analytics, audit, notification, and consumer completion');
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

const notificationReady = await request(`${platform.notificationBase}/api/v1/health/ready`);
assertStatus(notificationReady, 200, 'notification readiness');

const settledConsumerGroups = await waitForConsumerGroupsSettled();

logStep('End-to-end verification completed successfully');
console.log(JSON.stringify({
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

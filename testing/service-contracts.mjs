import assert from 'node:assert/strict';

import {
  assertArrayContains,
  assertKafkaTopicsPresent,
  assertStatus,
  authHeaders,
  buildFlaggedTransactionPayload,
  checkHtmlPage,
  credentials,
  kafka,
  logStep,
  makeCustomer,
  platform,
  poll,
  request,
  setCustomerPasswordless,
  staffLogin,
  tracing,
  waitForConsumerGroupsSettled,
  waitForJaegerServices,
  waitForLatestOtp,
  waitForStack,
} from './helpers.mjs';

const registerCustomerDirect = async (customer) => {
  const result = await request(`${platform.customerBase}/register`, {
    method: 'POST',
    body: customer,
  });

  assertStatus(result, [200, 201], `direct register ${customer.email}`);
  assert.equal(result.body?.requires_otp, true, `direct register ${customer.email}: expected requires_otp=true`);
  return {
    ...customer,
  };
};

const loginCustomerDirect = async (customer, password = customer.password) => {
  const result = await request(`${platform.customerBase}/login`, {
    method: 'POST',
    body: { email: customer.email, password },
  });

  assertStatus(result, 200, `direct login ${customer.email}`);
  assert.equal(result.body?.requires_otp, true, `direct login ${customer.email}: expected requires_otp=true`);
  return result;
};

const verifyCustomerOtpDirect = async (customer, otpCode) => {
  const result = await request(`${platform.customerBase}/verify-otp`, {
    method: 'POST',
    body: {
      email: customer.email,
      otp_code: otpCode,
    },
  });

  assertStatus(result, 200, `direct verify otp ${customer.email}`);
  return {
    ...customer,
    verifiedToken: result.body.access_token,
    customerId: result.body.customer.customer_id,
  };
};

const createFlaggedTransactionDirect = async (customer, recipient, amount) => {
  const result = await request(`${platform.transactionBase}/transactions`, {
    method: 'POST',
    body: buildFlaggedTransactionPayload({
      customerId: customer.customerId,
      senderName: customer.full_name,
      recipientCustomerId: recipient.customerId,
      recipientName: recipient.full_name,
      amount,
    }),
  });

  assertStatus(result, 201, `direct create transaction for ${customer.email}`);
  return result.body.transaction_id;
};

const getTransactionDecisionDirect = async (transactionId) => {
  const result = await request(`${platform.transactionBase}/transactions/${transactionId}/decision`);
  assertStatus(result, 200, `direct transaction decision ${transactionId}`);
  return result;
};

const waitForTransactionStatus = async (transactionId, expectedStatus) => poll(
  `transaction ${transactionId} -> ${expectedStatus}`,
  () => getTransactionDecisionDirect(transactionId),
  (result) => result.body?.status === expectedStatus,
  { timeoutMs: 120000, intervalMs: 2500 }
);

await waitForStack();

logStep('Signing in staff roles for protected UI, service, and observability validation');
const analystSession = await staffLogin(credentials.analyst);
const managerSession = await staffLogin(credentials.manager);
const opsReadonlySession = await staffLogin(credentials.opsReadonly);
const opsAdminSession = await staffLogin(credentials.opsAdmin);

logStep('Validating direct service health surfaces');
const directHealthChecks = [
  { name: 'customer health', url: `${platform.customerBase}/health`, status: 200 },
  { name: 'customer live', url: `${platform.customerBase}/health/live`, status: 200 },
  { name: 'customer ready', url: `${platform.customerBase}/health/ready`, status: 200 },
  { name: 'transaction health', url: `${platform.transactionBase}/health`, status: 200 },
  { name: 'transaction live', url: `${platform.transactionBase}/health/live`, status: 200 },
  { name: 'transaction ready', url: `${platform.transactionBase}/health/ready`, status: 200 },
  { name: 'fraud-score health', url: `${platform.fraudScoreBase}/health`, status: 200 },
  { name: 'fraud-score live', url: `${platform.fraudScoreBase}/api/v1/health/live`, status: 200 },
  { name: 'fraud-score ready', url: `${platform.fraudScoreBase}/api/v1/health/ready`, status: 200 },
  { name: 'detect-fraud health', url: `${platform.detectFraudBase}/health`, status: 200 },
  { name: 'detect-fraud live', url: `${platform.detectFraudBase}/health/live`, status: 200 },
  { name: 'detect-fraud ready', url: `${platform.detectFraudBase}/health/ready`, status: 200 },
  { name: 'fraud-review health', url: `${platform.fraudReviewBase}/api/v1/health`, status: 200 },
  { name: 'fraud-review live', url: `${platform.fraudReviewBase}/health/live`, status: 200 },
  { name: 'appeal health', url: `${platform.appealBase}/health`, status: 200 },
  { name: 'analytics health', url: `${platform.analyticsBase}/health`, status: 200 },
  { name: 'analytics live', url: `${platform.analyticsBase}/health/live`, status: 200 },
  { name: 'audit health', url: `${platform.auditBase}/api/v1/health`, status: 200 },
  { name: 'audit live', url: `${platform.auditBase}/api/v1/health/live`, status: 200 },
  { name: 'notification health', url: `${platform.notificationBase}/api/v1/health`, status: 200 },
  { name: 'notification live', url: `${platform.notificationBase}/api/v1/health/live`, status: 200 },
  { name: 'notification ready', url: `${platform.notificationBase}/api/v1/health/ready`, status: 200 },
  { name: 'gateway health', url: `${platform.gatewayBase}/health`, status: 200 },
  { name: 'gateway live', url: `${platform.gatewayBase}/health/live`, status: 200 },
  { name: 'gateway ready', url: `${platform.gatewayBase}/health/ready`, status: 200 },
];

for (const check of directHealthChecks) {
  const result = await request(check.url);
  assertStatus(result, check.status, check.name);
}

logStep('Validating protected UI and observability surfaces');
await checkHtmlPage(`${platform.publicBase}/`, 'public edge root');
await checkHtmlPage(`${platform.publicBase}/swagger/`, 'public swagger ui', 'Fraud Detection REST API Documentation');
await checkHtmlPage(`${platform.nginxBase}/staff-login.html`, 'staff login ui', 'FTDS | Staff Sign In');
await checkHtmlPage(`${platform.httpsBase}/staff-login.html`, 'https staff login ui', 'FTDS | Staff Sign In', {
  insecureTls: true,
});
await checkHtmlPage(`${platform.nginxBase}/fraud-review.html`, 'fraud review redirect to staff login', 'FTDS | Staff Sign In');
await checkHtmlPage(`${platform.nginxBase}/manager.html`, 'manager redirect to staff login', 'FTDS | Staff Sign In');
await checkHtmlPage(`${platform.httpsBase}/fraud-review.html`, 'fraud review console', 'FTDS | Fraud Review', {
  headers: { Cookie: analystSession.cookie },
  insecureTls: true,
});
await checkHtmlPage(`${platform.httpsBase}/manager.html`, 'manager console', 'FTDS | Manager Console', {
  headers: { Cookie: managerSession.cookie },
  insecureTls: true,
});

const staffMe = await request(`${platform.publicBase}/api/staff/me`, {
  headers: { Cookie: analystSession.cookie },
});
assertStatus(staffMe, 200, 'staff me');
assert.equal(staffMe.body?.user?.role, 'fraud_analyst', 'staff me should report analyst role');

const grafanaHealth = await request(`${platform.grafanaBase}/api/health`, {
  headers: { Cookie: opsReadonlySession.cookie },
});
assertStatus(grafanaHealth, 200, 'grafana health');
assert.equal(grafanaHealth.body?.database, 'ok', 'grafana database health should be ok');

const grafanaDashboards = await request(`${platform.grafanaBase}/api/search?type=dash-db`, {
  headers: { Cookie: opsReadonlySession.cookie },
});
assertStatus(grafanaDashboards, 200, 'grafana dashboards list');
assert.ok(Array.isArray(grafanaDashboards.body), 'grafana dashboards list should return an array');
assert.ok(grafanaDashboards.body.length >= 2, 'grafana should provision at least two dashboards');

await checkHtmlPage(`${platform.jaegerBase}/`, 'jaeger ui', undefined, {
  headers: { Cookie: opsReadonlySession.cookie },
});

const prometheusReady = await request(`${platform.prometheusBase}/-/ready`, {
  headers: { Cookie: opsReadonlySession.cookie },
});
assertStatus(prometheusReady, 200, 'prometheus ready');

const cadvisorHealth = await request(`${platform.cadvisorBase}/healthz`, {
  headers: { Cookie: opsReadonlySession.cookie },
});
assertStatus(cadvisorHealth, 200, 'cadvisor health');
assert.ok(String(cadvisorHealth.text || cadvisorHealth.body || '').toLowerCase().includes('ok'), 'cadvisor health should report ok');

await checkHtmlPage(`${platform.mailpitBase}/`, 'mailpit ui', undefined, {
  headers: { Cookie: opsAdminSession.cookie },
});
const baselineMailpitMessages = await request(`${platform.mailpitBase}/api/v1/messages`, {
  headers: { Cookie: opsAdminSession.cookie },
});
assertStatus(baselineMailpitMessages, 200, 'mailpit messages baseline');
const baselineMailpitCount = Number(
  baselineMailpitMessages.body?.total
  ?? baselineMailpitMessages.body?.messages_count
  ?? baselineMailpitMessages.body?.count
  ?? 0
);

const kafkaTopics = await assertKafkaTopicsPresent();
assert.ok(kafka.requiredTopics.every((topic) => kafkaTopics.includes(topic)), 'all required kafka topics should exist');

logStep('Capturing analytics baselines with staff JWT auth');
const baselineLegacyDashboard = await request(`${platform.analyticsBase}/dashboard`, {
  headers: authHeaders(managerSession.token),
});
assertStatus(baselineLegacyDashboard, 200, 'analytics legacy dashboard baseline');

const baselineModernDashboard = await request(`${platform.analyticsBase}/api/v1/analytics/dashboard`, {
  headers: authHeaders(managerSession.token),
});
assertStatus(baselineModernDashboard, 200, 'analytics modern dashboard baseline');
assert.equal(baselineModernDashboard.body?.success, true, 'analytics modern dashboard baseline should succeed');

const baselineRealtime = await request(`${platform.analyticsBase}/api/v1/analytics/realtime`, {
  headers: authHeaders(managerSession.token),
});
assertStatus(baselineRealtime, 200, 'analytics realtime baseline');
assert.equal(baselineRealtime.body?.success, true, 'analytics realtime baseline should succeed');

logStep('Creating disposable customers for direct contract validation');
let primaryCustomer = await registerCustomerDirect(makeCustomer('contracts-primary'));
let recipientCustomer = await registerCustomerDirect(makeCustomer('contracts-recipient'));

await loginCustomerDirect(primaryCustomer);
const primaryOtp = await waitForLatestOtp(primaryCustomer.email);
primaryCustomer = await verifyCustomerOtpDirect(primaryCustomer, primaryOtp);
const recipientOtp = await waitForLatestOtp(recipientCustomer.email);
recipientCustomer = await verifyCustomerOtpDirect(recipientCustomer, recipientOtp);

await setCustomerPasswordless(primaryCustomer.customerId);

const passwordlessCustomerProfile = await request(`${platform.customerBase}/me`, {
  headers: authHeaders(primaryCustomer.verifiedToken),
});
assertStatus(passwordlessCustomerProfile, 200, 'passwordless customer profile');
assert.equal(passwordlessCustomerProfile.body?.has_password, false, 'passwordless direct customer should report has_password=false');

assertStatus(await request(`${platform.customerBase}/login`, {
  method: 'POST',
  body: { email: primaryCustomer.email, password: primaryCustomer.password },
}), 403, 'passwordless direct login should be forbidden');

assertStatus(await request(`${platform.customerBase}/me`, {
  method: 'PUT',
  headers: authHeaders(primaryCustomer.verifiedToken),
  body: { full_name: `${primaryCustomer.full_name} Blocked` },
}), 428, 'passwordless customer update profile should be blocked');

const passwordlessSetupOtpRequest = await request(`${platform.customerBase}/me/request-otp`, {
  method: 'POST',
  headers: authHeaders(primaryCustomer.verifiedToken),
});
assertStatus(passwordlessSetupOtpRequest, 200, 'passwordless request setup otp');

const passwordlessSetupOtp = await waitForLatestOtp(primaryCustomer.email);
const passwordlessSetupResult = await request(`${platform.customerBase}/me/password/set`, {
  method: 'POST',
  headers: authHeaders(primaryCustomer.verifiedToken),
  body: {
    new_password: `${primaryCustomer.password}-local`,
    otp_code: passwordlessSetupOtp,
  },
});
assertStatus(passwordlessSetupResult, 200, 'passwordless set password');
assert.equal(passwordlessSetupResult.body?.customer?.has_password, true, 'passwordless set password should restore local password state');
primaryCustomer.password = `${primaryCustomer.password}-local`;

const resendOtp = await request(`${platform.customerBase}/resend-otp`, {
  method: 'POST',
  body: { email: primaryCustomer.email },
});
assertStatus(resendOtp, 200, 'customer resend otp');

const lookupByEmail = await request(
  `${platform.customerBase}/lookup?query=${encodeURIComponent(recipientCustomer.email)}`,
  { headers: authHeaders(primaryCustomer.verifiedToken) }
);
assertStatus(lookupByEmail, 200, 'customer lookup by email');
assert.equal(lookupByEmail.body?.customer_id, recipientCustomer.customerId, 'lookup by email returned unexpected customer');

const lookupByPhone = await request(
  `${platform.customerBase}/lookup?query=${encodeURIComponent(recipientCustomer.phone)}`,
  { headers: authHeaders(primaryCustomer.verifiedToken) }
);
assertStatus(lookupByPhone, 200, 'customer lookup by phone');
assert.equal(lookupByPhone.body?.customer_id, recipientCustomer.customerId, 'lookup by phone returned unexpected customer');

const internalContact = await request(`${platform.customerBase}/internal/contact/${recipientCustomer.customerId}`);
assertStatus(internalContact, 200, 'customer internal contact lookup');
assert.equal(internalContact.body?.customer_id, recipientCustomer.customerId, 'internal contact lookup returned unexpected customer');

const currentProfile = await request(`${platform.customerBase}/me`, {
  headers: authHeaders(primaryCustomer.verifiedToken),
});
assertStatus(currentProfile, 200, 'customer me');
assert.equal(currentProfile.body?.email, primaryCustomer.email, 'customer me returned unexpected email');

const updatedProfile = await request(`${platform.customerBase}/me`, {
  method: 'PUT',
  headers: authHeaders(primaryCustomer.verifiedToken),
  body: {
    full_name: `${primaryCustomer.full_name} Updated`,
    phone: `+6592${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
  },
});
assertStatus(updatedProfile, 200, 'customer update profile');
primaryCustomer = {
  ...primaryCustomer,
  full_name: updatedProfile.body.full_name,
  phone: updatedProfile.body.phone,
};

logStep('Validating fraud-score docs, model, metrics, and score endpoints');
const fraudScoreDocs = await request(`${platform.fraudScoreBase}/docs`);
assertStatus(fraudScoreDocs, 200, 'fraud-score docs');
const fraudScoreModel = await request(`${platform.fraudScoreBase}/model`);
assertStatus(fraudScoreModel, 200, 'fraud-score model');
const fraudScoreMetrics = await request(`${platform.fraudScoreBase}/metrics`);
assertStatus(fraudScoreMetrics, 200, 'fraud-score metrics');
assert.ok(fraudScoreMetrics.text.includes('# HELP'), 'fraud-score metrics should expose prometheus help text');
const fraudScoreDocsJson = await request(`${platform.fraudScoreBase}/api-docs.json`);
assertStatus(fraudScoreDocsJson, 200, 'fraud-score api docs');
assert.ok(fraudScoreDocsJson.body?.openapi, 'fraud-score api docs should expose openapi');

const scorePayload = {
  transaction: {
    amount: 3600,
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
};
assertStatus(await request(`${platform.fraudScoreBase}/score`, { method: 'POST', body: scorePayload }), 200, 'fraud-score canonical score');
assertStatus(await request(`${platform.fraudScoreBase}/api/v1/score`, { method: 'POST', body: scorePayload }), 200, 'fraud-score versioned score');

logStep('Validating gateway docs and modern auth proxy');
const gatewayDocs = await request(`${platform.gatewayBase}/api-docs.json`);
assertStatus(gatewayDocs, 200, 'gateway api docs');
assert.ok(gatewayDocs.body?.openapi, 'gateway api docs should expose openapi');
const gatewaySwaggerAlias = await request(`${platform.gatewayBase}/swagger.json`);
assertStatus(gatewaySwaggerAlias, 200, 'gateway swagger alias');
assert.ok(gatewaySwaggerAlias.body?.openapi, 'gateway swagger alias should expose openapi');

const gatewayLogin = await request(`${platform.gatewayBase}/api/v1/auth/login`, {
  method: 'POST',
  body: { email: primaryCustomer.email, password: primaryCustomer.password },
});
assertStatus(gatewayLogin, 200, 'gateway modern auth login');

logStep('Creating flagged transactions for transaction, review, and appeal coverage');
const reviewedTransactionId = await createFlaggedTransactionDirect(primaryCustomer, recipientCustomer, 3600);
await waitForTransactionStatus(reviewedTransactionId, 'FLAGGED');

const appealTransactionId = await createFlaggedTransactionDirect(primaryCustomer, recipientCustomer, 3700);
await waitForTransactionStatus(appealTransactionId, 'FLAGGED');

const directTransactionList = await request(
  `${platform.transactionBase}/transactions?customer_id=${encodeURIComponent(primaryCustomer.customerId)}&direction=all`
);
assertStatus(directTransactionList, 200, 'transaction list by query');
assertArrayContains(
  directTransactionList.body,
  (item) => item.transaction_id === reviewedTransactionId,
  'transaction list by query should include reviewed transaction'
);

const directCustomerTransactionList = await request(
  `${platform.transactionBase}/transactions/customer/${primaryCustomer.customerId}?direction=all`
);
assertStatus(directCustomerTransactionList, 200, 'transaction list by customer path');
assertArrayContains(
  directCustomerTransactionList.body,
  (item) => item.transaction_id === appealTransactionId,
  'transaction list by customer path should include appeal transaction'
);

const gatewayTransactionList = await request(
  `${platform.gatewayBase}/api/v1/transactions/customer/${primaryCustomer.customerId}?direction=all`,
  { headers: authHeaders(primaryCustomer.verifiedToken) }
);
assertStatus(gatewayTransactionList, 200, 'gateway modern transaction list');

logStep('Validating direct fraud-review APIs with authenticated analyst role');
const reviewCases = await poll(
  'review cases include reviewed transaction',
  () => request(`${platform.fraudReviewBase}/api/v1/review-cases?status=PENDING,IN_REVIEW`, {
    headers: authHeaders(analystSession.token),
  }),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.transactionId === reviewedTransactionId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(reviewCases.body.data, (item) => item.transactionId === reviewedTransactionId, 'review cases should include reviewed transaction');

const claimReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
});
assertStatus(claimReview, 200, 'fraud-review claim review case');
assert.equal(claimReview.body?.data?.claimedBy, analystSession.user.userId, 'claim should record authenticated analyst');
assert.equal(claimReview.body?.data?.claimedRole, analystSession.user.role, 'claim should record authenticated analyst role');

const releaseReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/release`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { notes: 'Released once to validate release path' },
});
assertStatus(releaseReview, 200, 'fraud-review release review case');

const reclaimReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
});
assertStatus(reclaimReview, 200, 'fraud-review reclaim review case');

const resolveReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/resolve`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: {
    decision: 'APPROVED',
    notes: 'Validated customer context via contract suite',
  },
});
assertStatus(resolveReview, 200, 'fraud-review resolve review case');
assert.equal(resolveReview.body?.data?.reviewedBy, analystSession.user.userId, 'resolve should record authenticated analyst');
assert.equal(resolveReview.body?.data?.reviewedRole, analystSession.user.role, 'resolve should record analyst role');
await waitForTransactionStatus(reviewedTransactionId, 'APPROVED');

logStep('Validating appeal service ownership and internal staff APIs');
const createAppeal = await request(`${platform.appealBase}/api/v1/appeals`, {
  method: 'POST',
  body: {
    transactionId: appealTransactionId,
    customerId: primaryCustomer.customerId,
    appealReason: 'Direct contract appeal with sufficient detail and supporting evidence.',
    evidence: { suite: 'service-contracts', verifiedBy: 'automation' },
  },
});
assertStatus(createAppeal, 201, 'appeal create');
const appealId = createAppeal.body?.data?.appealId;
assert.ok(appealId, 'appeal create should return appealId');

const modernPendingAppeals = await poll(
  'fraud-review appeal queue includes created appeal',
  () => request(`${platform.fraudReviewBase}/api/v1/reviews/appeals/pending?limit=50&offset=0`, {
    headers: authHeaders(analystSession.token),
  }),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.appealId === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(modernPendingAppeals.body?.data, (item) => item.appealId === appealId, 'modern appeal queue should include created appeal');

const internalPendingAppeals = await request(`${platform.appealBase}/api/v1/internal/appeals/pending`, {
  headers: authHeaders(analystSession.token),
});
assertStatus(internalPendingAppeals, 200, 'appeal internal pending list');
assertArrayContains(internalPendingAppeals.body?.data, (item) => item.appealId === appealId, 'internal appeal queue should include created appeal');

const claimAppeal = await request(`${platform.appealBase}/api/v1/internal/appeals/${appealId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
});
assertStatus(claimAppeal, 200, 'appeal internal claim');
assert.equal(claimAppeal.body?.data?.claimedBy, analystSession.user.userId, 'appeal claim should record authenticated analyst');
assert.equal(claimAppeal.body?.data?.claimedRole, analystSession.user.role, 'appeal claim should record analyst role');

const releaseAppeal = await request(`${platform.appealBase}/api/v1/internal/appeals/${appealId}/release`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { notes: 'Released once to validate release path' },
});
assertStatus(releaseAppeal, 200, 'appeal internal release');

const reclaimAppeal = await request(`${platform.appealBase}/api/v1/internal/appeals/${appealId}/claim`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: { claimTtlMinutes: 5 },
});
assertStatus(reclaimAppeal, 200, 'appeal internal reclaim');

const resolveAppeal = await request(`${platform.appealBase}/api/v1/internal/appeals/${appealId}/resolve`, {
  method: 'POST',
  headers: authHeaders(analystSession.token),
  body: {
    resolution: 'REVERSE',
    notes: 'Supporting evidence validated by contract suite',
  },
});
assertStatus(resolveAppeal, 200, 'appeal internal resolve');
assert.equal(resolveAppeal.body?.data?.reviewedBy, analystSession.user.userId, 'appeal resolve should record authenticated analyst');
assert.equal(resolveAppeal.body?.data?.resolvedRole, analystSession.user.role, 'appeal resolve should record analyst role');
await waitForTransactionStatus(appealTransactionId, 'APPROVED');

logStep('Validating analytics projections after manual review and appeal resolution');
const legacyDashboard = await poll(
  'analytics legacy dashboard reflects contract activity',
  () => request(`${platform.analyticsBase}/dashboard`, {
    headers: authHeaders(managerSession.token),
  }),
  (result) => result.status === 200
    && Number(result.body?.transactions_approved) >= Number(baselineLegacyDashboard.body?.transactions_approved || 0) + 2
    && Number(result.body?.appeals_created) >= Number(baselineLegacyDashboard.body?.appeals_created || 0) + 1
    && Number(result.body?.appeals_approved) >= Number(baselineLegacyDashboard.body?.appeals_approved || 0) + 1,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const modernDashboard = await poll(
  'analytics modern dashboard reflects contract activity',
  () => request(`${platform.analyticsBase}/api/v1/analytics/dashboard`, {
    headers: authHeaders(managerSession.token),
  }),
  (result) => result.status === 200
    && result.body?.success === true
    && Number(result.body?.data?.overview?.totalTransactions) >= Number(baselineModernDashboard.body?.data?.overview?.totalTransactions || 0) + 2
    && Number(result.body?.data?.appealImpact?.appealsCreated) >= Number(baselineModernDashboard.body?.data?.appealImpact?.appealsCreated || 0) + 1
    && Number(result.body?.data?.appealImpact?.reversedCount) >= Number(baselineModernDashboard.body?.data?.appealImpact?.reversedCount || 0) + 1,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const realtimeStats = await poll(
  'analytics realtime reflects recent contract activity',
  () => request(`${platform.analyticsBase}/api/v1/analytics/realtime`, {
    headers: authHeaders(managerSession.token),
  }),
  (result) => result.status === 200
    && result.body?.success === true
    && Number(result.body?.data?.totalDecisions) >= Number(baselineRealtime.body?.data?.totalDecisions || 0) + 2,
  { timeoutMs: 120000, intervalMs: 2500 }
);

logStep('Validating audit and notification surfaces');
const transactionAudit = await poll(
  'audit transaction trail recorded appeal transaction events',
  () => request(`${platform.auditBase}/api/v1/audit/transaction/${appealTransactionId}`),
  (result) => result.status === 200
    && Number(result.body?.data?.eventCount) > 0
    && Array.isArray(result.body?.data?.events)
    && result.body.data.events.some((item) => ['appeal.created', 'appeal.resolved', 'transaction.flagged', 'transaction.finalised'].includes(item.eventType)),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const customerAudit = await poll(
  'audit customer trail recorded contract customer events',
  () => request(`${platform.auditBase}/api/v1/audit/customer/${primaryCustomer.customerId}`),
  (result) => result.status === 200
    && Number(result.body?.data?.eventCount) > 0,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const verifyAudit = await request(`${platform.auditBase}/api/v1/audit/verify`, {
  method: 'POST',
  body: {
    startEventId: Math.min(...transactionAudit.body.data.events.map((item) => Number(item.eventId)).filter(Number.isFinite)),
    endEventId: Math.max(...transactionAudit.body.data.events.map((item) => Number(item.eventId)).filter(Number.isFinite)),
  },
});
assertStatus(verifyAudit, 200, 'audit verify integrity');
assert.equal(verifyAudit.body?.data?.verified, true, 'audit chain should verify successfully');

const notificationMetrics = await poll(
  'notification metrics reflect consumed messages',
  () => request(`${platform.notificationBase}/api/v1/metrics`),
  (result) => result.status === 200
    && /notification_kafka_messages_consumed_total\{[^}]*status="success"[^}]*\}\s+\d+/.test(result.text),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const mailpitMessages = await poll(
  'mailpit captured outbound emails',
  () => request(`${platform.mailpitBase}/api/v1/messages`, {
    headers: { Cookie: opsAdminSession.cookie },
  }),
  (result) => result.status === 200
    && Number(result.body?.total ?? result.body?.messages_count ?? result.body?.count ?? 0) > baselineMailpitCount,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const settledConsumerGroups = await waitForConsumerGroupsSettled();
const jaegerServices = await waitForJaegerServices(tracing.expectedServices, {}, { Cookie: opsReadonlySession.cookie });

logStep('Service-contract verification completed successfully');
console.log(JSON.stringify({
  staff: {
    analyst: analystSession.user,
    manager: managerSession.user,
    opsReadonly: opsReadonlySession.user,
    opsAdmin: opsAdminSession.user,
  },
  customers: {
    primary: primaryCustomer.customerId,
    recipient: recipientCustomer.customerId,
  },
  transactions: {
    reviewedApproved: reviewedTransactionId,
    appealApproved: appealTransactionId,
  },
  appealId,
  analytics: {
    legacy: legacyDashboard.body,
    modernOverview: modernDashboard.body?.data?.overview,
    realtime: realtimeStats.body?.data,
  },
  audit: {
    transactionEventCount: transactionAudit.body?.data?.eventCount,
    customerEventCount: customerAudit.body?.data?.eventCount,
  },
  notificationMetricsChecked: notificationMetrics.status === 200,
  jaegerServices,
  missingJaegerServices: tracing.expectedServices.filter((service) => !jaegerServices.includes(service)),
  mailpit: {
    baselineMessages: baselineMailpitCount,
    finalMessages: Number(mailpitMessages.body?.total ?? mailpitMessages.body?.messages_count ?? mailpitMessages.body?.count ?? 0),
  },
  consumerGroups: Object.fromEntries(
    Object.entries(settledConsumerGroups).map(([group, details]) => [
      group,
      { state: details.state, totalLag: details.totalLag },
    ])
  ),
}, null, 2));

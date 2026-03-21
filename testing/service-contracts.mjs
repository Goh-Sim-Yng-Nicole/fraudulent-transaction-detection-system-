import assert from 'node:assert/strict';

import {
  assertArrayContains,
  assertKafkaTopicsPresent,
  assertStatus,
  authHeaders,
  basicAuthHeaders,
  buildFlaggedTransactionPayload,
  checkHtmlPage,
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

const registerCustomerDirect = async (customer) => {
  const result = await request(`${platform.customerBase}/register`, {
    method: 'POST',
    body: customer,
  });

  assertStatus(result, 201, `direct register ${customer.email}`);
  assert.ok(result.body?.access_token, `direct register ${customer.email}: missing access token`);
  assert.ok(result.body?.customer?.customer_id, `direct register ${customer.email}: missing customer id`);

  return {
    ...customer,
    registrationToken: result.body.access_token,
    customerId: result.body.customer.customer_id,
  };
};

const loginCustomerDirect = async (customer, password = customer.password) => {
  const result = await request(`${platform.customerBase}/login`, {
    method: 'POST',
    body: {
      email: customer.email,
      password,
    },
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
  assert.ok(result.body?.access_token, `direct verify otp ${customer.email}: missing access token`);

  return {
    ...customer,
    verifiedToken: result.body.access_token,
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
  assert.ok(result.body?.transaction_id, 'direct create transaction: missing transaction_id');
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

logStep('Validating UI and infrastructure surfaces');
await checkHtmlPage(`${platform.publicBase}/`, 'public edge root');
await checkHtmlPage(`${platform.nginxBase}/banking.html`, 'banking ui');
await checkHtmlPage(`${platform.nginxBase}/fraud-review.html`, 'fraud review ui');
await checkHtmlPage(`${platform.nginxBase}/manager.html`, 'manager ui');
await checkHtmlPage(`${platform.fraudReviewBase}/`, 'fraud review service dashboard');
await checkHtmlPage(`${platform.analyticsBase}/`, 'analytics service dashboard');

const kongStatus = await request(`${platform.kongAdminBase}/status`);
assertStatus(kongStatus, 200, 'kong admin status');

const prometheusReady = await request(`${platform.prometheusBase}/-/ready`);
assertStatus(prometheusReady, 200, 'prometheus ready');

const grafanaHealth = await request(`${platform.grafanaBase}/api/health`);
assertStatus(grafanaHealth, 200, 'grafana health');
assert.equal(grafanaHealth.body?.database, 'ok', 'grafana database health should be ok');

const grafanaHomeDashboard = await request(`${platform.grafanaBase}/api/dashboards/home`);
assertStatus(grafanaHomeDashboard, 200, 'grafana home dashboard');
assert.equal(
  grafanaHomeDashboard.body?.dashboard?.title,
  'Fraud Detection Platform',
  'grafana root should land on the Fraud Detection Platform dashboard'
);

const grafanaDashboards = await request(`${platform.grafanaBase}/api/search?type=dash-db`, {
  headers: basicAuthHeaders(
    process.env.GRAFANA_USER || 'admin',
    process.env.GRAFANA_PASSWORD || 'admin123',
  ),
});
assertStatus(grafanaDashboards, 200, 'grafana dashboards list');
assert.ok(Array.isArray(grafanaDashboards.body), 'grafana dashboards list should return an array');
assert.ok(grafanaDashboards.body.length >= 2, 'grafana should provision at least two dashboards');

await checkHtmlPage(`${platform.jaegerBase}/`, 'jaeger ui');
await checkHtmlPage(`${platform.mailpitBase}/`, 'mailpit ui');
const baselineMailpitMessages = await request(`${platform.mailpitBase}/api/v1/messages`);
assertStatus(baselineMailpitMessages, 200, 'mailpit messages baseline');
const baselineMailpitCount = Number(
  baselineMailpitMessages.body?.total
  ?? baselineMailpitMessages.body?.messages_count
  ?? baselineMailpitMessages.body?.count
  ?? 0
);

const cadvisorHealth = await request(`${platform.cadvisorBase}/healthz`);
assertStatus(cadvisorHealth, 200, 'cadvisor health');
assert.ok(String(cadvisorHealth.text || cadvisorHealth.body || '').toLowerCase().includes('ok'), 'cadvisor health should report ok');

const kafkaTopics = await assertKafkaTopicsPresent();
logStep(`Kafka topics verified: ${kafkaTopics.join(', ')}`);

logStep('Capturing analytics baselines');
const managerLogin = await request(`${platform.analyticsBase}/login`, {
  method: 'POST',
  body: credentials.manager,
});
assertStatus(managerLogin, 200, 'analytics legacy login');
const managerToken = managerLogin.body?.access_token;
assert.ok(managerToken, 'analytics legacy login missing access token');

const baselineLegacyDashboard = await request(`${platform.analyticsBase}/dashboard`, {
  headers: authHeaders(managerToken),
});
assertStatus(baselineLegacyDashboard, 200, 'analytics legacy dashboard baseline');

const baselineModernDashboard = await request(`${platform.analyticsBase}/api/v1/analytics/dashboard`, {
  headers: authHeaders(managerToken),
});
assertStatus(baselineModernDashboard, 200, 'analytics modern dashboard baseline');
assert.equal(baselineModernDashboard.body?.success, true, 'analytics modern dashboard baseline should succeed');

const baselineRealtime = await request(`${platform.analyticsBase}/api/v1/analytics/realtime`, {
  headers: authHeaders(managerToken),
});
assertStatus(baselineRealtime, 200, 'analytics realtime baseline');
assert.equal(baselineRealtime.body?.success, true, 'analytics realtime baseline should succeed');

logStep('Creating disposable customers for direct contract validation');
let primaryCustomer = await registerCustomerDirect(makeCustomer('contracts-primary'));
const recipientCustomer = await registerCustomerDirect(makeCustomer('contracts-recipient'));

await loginCustomerDirect(primaryCustomer);
const primaryOtp = await waitForLatestOtp(primaryCustomer.email);
primaryCustomer = await verifyCustomerOtpDirect(primaryCustomer, primaryOtp);

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
assert.ok(String(updatedProfile.body?.full_name || '').endsWith('Updated'), 'customer update profile should update full_name');
primaryCustomer = {
  ...primaryCustomer,
  full_name: updatedProfile.body.full_name,
  phone: updatedProfile.body.phone,
};

logStep('Validating fraud-score docs, model, metrics, and score endpoints');
const fraudScoreDocs = await request(`${platform.fraudScoreBase}/docs`);
assertStatus(fraudScoreDocs, 200, 'fraud-score docs');
assert.equal(fraudScoreDocs.body?.service, 'fraud-score', 'fraud-score docs should identify service');

const fraudScoreModel = await request(`${platform.fraudScoreBase}/model`);
assertStatus(fraudScoreModel, 200, 'fraud-score model');
assert.ok(Array.isArray(fraudScoreModel.body?.feature_names), 'fraud-score model should expose feature names');

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

const canonicalScore = await request(`${platform.fraudScoreBase}/score`, {
  method: 'POST',
  body: scorePayload,
});
assertStatus(canonicalScore, 200, 'fraud-score canonical score');
assert.equal(canonicalScore.body?.success, true, 'fraud-score canonical score should succeed');

const versionedScore = await request(`${platform.fraudScoreBase}/api/v1/score`, {
  method: 'POST',
  body: scorePayload,
});
assertStatus(versionedScore, 200, 'fraud-score versioned score');
assert.equal(versionedScore.body?.success, true, 'fraud-score versioned score should succeed');

logStep('Validating gateway docs and modern auth proxy');
const gatewayDocs = await request(`${platform.gatewayBase}/api-docs.json`);
assertStatus(gatewayDocs, 200, 'gateway api docs');
assert.ok(gatewayDocs.body?.openapi, 'gateway api docs should expose openapi');

const gatewayLogin = await request(`${platform.gatewayBase}/api/v1/auth/login`, {
  method: 'POST',
  body: {
    email: primaryCustomer.email,
    password: primaryCustomer.password,
  },
});
assertStatus(gatewayLogin, 200, 'gateway modern auth login');
assert.equal(gatewayLogin.body?.requires_otp, true, 'gateway modern auth login should require OTP');

logStep('Creating flagged transactions for direct transaction, review, and appeal coverage');
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
  (item) => item.transaction_id === reviewedTransactionId && item.customer_id === primaryCustomer.customerId,
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

const reviewedTransaction = await request(`${platform.transactionBase}/transactions/${reviewedTransactionId}`);
assertStatus(reviewedTransaction, 200, 'transaction get by id');
assert.equal(reviewedTransaction.body?.transaction_id, reviewedTransactionId, 'transaction get by id returned unexpected transaction');

const reviewedDecision = await request(`${platform.transactionBase}/transactions/${reviewedTransactionId}/decision`);
assertStatus(reviewedDecision, 200, 'transaction get decision');
assert.equal(reviewedDecision.body?.status, 'FLAGGED', 'transaction decision should be FLAGGED before manual review');

const gatewayTransactionList = await request(
  `${platform.gatewayBase}/api/v1/transactions/customer/${primaryCustomer.customerId}?direction=all`,
  { headers: authHeaders(primaryCustomer.verifiedToken) }
);
assertStatus(gatewayTransactionList, 200, 'gateway modern transaction list');
assertArrayContains(
  gatewayTransactionList.body,
  (item) => item.transaction_id === reviewedTransactionId,
  'gateway modern transaction list should include reviewed transaction'
);

logStep('Validating modern fraud-review APIs');
const reviewCases = await poll(
  'review cases include reviewed transaction',
  () => request(`${platform.fraudReviewBase}/api/v1/review-cases?status=PENDING,IN_REVIEW`),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.transactionId === reviewedTransactionId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(
  reviewCases.body.data,
  (item) => item.transactionId === reviewedTransactionId,
  'review cases should include reviewed transaction'
);

const reviewsPending = await request(`${platform.fraudReviewBase}/api/v1/reviews/pending`);
assertStatus(reviewsPending, 200, 'fraud-review pending reviews');
assertArrayContains(
  reviewsPending.body?.data,
  (item) => item.transactionId === reviewedTransactionId,
  'pending reviews should include reviewed transaction'
);

const reviewRecord = await request(`${platform.fraudReviewBase}/api/v1/reviews/${reviewedTransactionId}`);
assertStatus(reviewRecord, 200, 'fraud-review get review by transaction');
assert.equal(reviewRecord.body?.data?.transactionId, reviewedTransactionId, 'fraud-review get review returned unexpected transaction');

const claimReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/claim`, {
  method: 'POST',
  body: {
    reviewerId: 'contracts-modern-analyst',
    claimTtlMinutes: 5,
  },
});
assertStatus(claimReview, 200, 'fraud-review claim review case');

const releaseReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/release`, {
  method: 'POST',
  body: {
    reviewerId: 'contracts-modern-analyst',
    notes: 'Released once to validate release path',
  },
});
assertStatus(releaseReview, 200, 'fraud-review release review case');

const reclaimReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/claim`, {
  method: 'POST',
  body: {
    reviewerId: 'contracts-modern-analyst',
    claimTtlMinutes: 5,
  },
});
assertStatus(reclaimReview, 200, 'fraud-review reclaim review case');

const resolveReview = await request(`${platform.fraudReviewBase}/api/v1/review-cases/${reviewedTransactionId}/resolve`, {
  method: 'POST',
  body: {
    decision: 'APPROVED',
    reviewedBy: 'contracts-modern-analyst',
    notes: 'Validated customer context via contract suite',
  },
});
assertStatus(resolveReview, 200, 'fraud-review resolve review case');
await waitForTransactionStatus(reviewedTransactionId, 'APPROVED');

logStep('Validating direct appeal APIs');
const createAppeal = await request(`${platform.appealBase}/api/v1/appeals`, {
  method: 'POST',
  body: {
    transactionId: appealTransactionId,
    customerId: primaryCustomer.customerId,
    appealReason: 'Direct contract appeal with sufficient detail and supporting evidence.',
    evidence: {
      suite: 'service-contracts',
      verifiedBy: 'automation',
    },
  },
});
assertStatus(createAppeal, 201, 'appeal create');
assert.equal(createAppeal.body?.success, true, 'appeal create should succeed');
const appealId = createAppeal.body?.data?.appealId;
assert.ok(appealId, 'appeal create should return appealId');

const legacyAppealsList = await request(
  `${platform.appealBase}/appeals?customer_id=${encodeURIComponent(primaryCustomer.customerId)}`
);
assertStatus(legacyAppealsList, 200, 'appeal legacy list');
assertArrayContains(
  legacyAppealsList.body,
  (item) => item.appeal_id === appealId,
  'appeal legacy list should include created appeal'
);

const modernAppealsList = await request(`${platform.appealBase}/api/v1/appeals/customer/${primaryCustomer.customerId}`);
assertStatus(modernAppealsList, 200, 'appeal modern list');
assertArrayContains(
  modernAppealsList.body?.data,
  (item) => item.appealId === appealId,
  'appeal modern list should include created appeal'
);

const legacyAppeal = await request(`${platform.appealBase}/appeals/${appealId}`);
assertStatus(legacyAppeal, 200, 'appeal legacy get');
assert.equal(legacyAppeal.body?.appeal?.appeal_id, appealId, 'appeal legacy get returned unexpected appeal');

const modernAppeal = await request(`${platform.appealBase}/api/v1/appeals/${appealId}`);
assertStatus(modernAppeal, 200, 'appeal modern get');
assert.equal(modernAppeal.body?.data?.appealId, appealId, 'appeal modern get returned unexpected appeal');

const pendingAppeals = await poll(
  'appeal internal pending list includes created appeal',
  () => request(`${platform.appealBase}/api/v1/internal/appeals/pending`),
  (result) => result.status === 200 && Array.isArray(result.body?.data)
    && result.body.data.some((item) => item.appealId === appealId),
  { timeoutMs: 120000, intervalMs: 2500 }
);
assertArrayContains(
  pendingAppeals.body?.data,
  (item) => item.appealId === appealId,
  'appeal internal pending list should include created appeal'
);

const resolveAppeal = await request(`${platform.appealBase}/api/v1/internal/appeals/${appealId}/resolve`, {
  method: 'POST',
  body: {
    resolution: 'REVERSE',
    reviewedBy: 'contracts-modern-analyst',
    notes: 'Supporting evidence validated by contract suite',
  },
});
assertStatus(resolveAppeal, 200, 'appeal internal resolve');
assert.equal(resolveAppeal.body?.success, true, 'appeal internal resolve should succeed');
await waitForTransactionStatus(appealTransactionId, 'APPROVED');

logStep('Validating analytics projections after manual review and appeal resolution');
const legacyDashboard = await poll(
  'analytics legacy dashboard reflects contract activity',
  () => request(`${platform.analyticsBase}/dashboard`, {
    headers: authHeaders(managerToken),
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
    headers: authHeaders(managerToken),
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
    headers: authHeaders(managerToken),
  }),
  (result) => result.status === 200
    && result.body?.success === true
    && Number(result.body?.data?.totalDecisions) >= Number(baselineRealtime.body?.data?.totalDecisions || 0) + 2
    && Number(result.body?.data?.overrides) >= Number(baselineRealtime.body?.data?.overrides || 0) + 1,
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
    && Number(result.body?.data?.eventCount) > 0
    && Array.isArray(result.body?.data?.events)
    && result.body.data.events.some((item) => [reviewedTransactionId, appealTransactionId].includes(item.transaction_id)),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const eventIds = transactionAudit.body.data.events
  .map((item) => Number(item.eventId))
  .filter(Number.isFinite);
assert.ok(eventIds.length > 0, 'audit transaction trail should expose event ids');

const verifyAudit = await request(`${platform.auditBase}/api/v1/audit/verify`, {
  method: 'POST',
  body: {
    startEventId: Math.min(...eventIds),
    endEventId: Math.max(...eventIds),
  },
});
assertStatus(verifyAudit, 200, 'audit verify integrity');
assert.equal(verifyAudit.body?.success, true, 'audit verify integrity should succeed');
assert.equal(verifyAudit.body?.data?.verified, true, 'audit chain should verify successfully');

const auditStats = await request(`${platform.auditBase}/api/v1/audit/stats`);
assertStatus(auditStats, 200, 'audit stats');
assert.ok(Number(auditStats.body?.data?.total_events) > 0, 'audit stats should report events');

const auditMetrics = await request(`${platform.auditBase}/api/v1/metrics`);
assertStatus(auditMetrics, 200, 'audit metrics');
assert.ok(auditMetrics.text.includes('audit_events_total'), 'audit metrics should expose audit event counters');

const notificationMetrics = await poll(
  'notification metrics reflect consumed messages',
  () => request(`${platform.notificationBase}/api/v1/metrics`),
  (result) => result.status === 200
    && result.text.includes('notification_kafka_messages_consumed_total')
    && /notification_kafka_messages_consumed_total\{[^}]*status="success"[^}]*\}\s+\d+/.test(result.text),
  { timeoutMs: 120000, intervalMs: 2500 }
);

const mailpitMessages = await poll(
  'mailpit captured outbound emails',
  () => request(`${platform.mailpitBase}/api/v1/messages`),
  (result) => result.status === 200
    && Number(
      result.body?.total
      ?? result.body?.messages_count
      ?? result.body?.count
      ?? 0
    ) > baselineMailpitCount,
  { timeoutMs: 120000, intervalMs: 2500 }
);

const settledConsumerGroups = await waitForConsumerGroupsSettled();

logStep('Service-contract verification completed successfully');
console.log(JSON.stringify({
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
  mailpit: {
    baselineMessages: baselineMailpitCount,
    finalMessages: Number(
      mailpitMessages.body?.total
      ?? mailpitMessages.body?.messages_count
      ?? mailpitMessages.body?.count
      ?? 0
    ),
  },
  consumerGroups: Object.fromEntries(
    Object.entries(settledConsumerGroups).map(([group, details]) => [
      group,
      { state: details.state, totalLag: details.totalLag },
    ])
  ),
}, null, 2));

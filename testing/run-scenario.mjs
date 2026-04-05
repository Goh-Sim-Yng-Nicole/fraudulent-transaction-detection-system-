import { authHeaders, credentials, makeCustomer, platform, poll, request, staffLogin, waitForLatestOtp, waitForStack } from './helpers.mjs';

function parseScenarioArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if ((value === '--scenario' || value === '-scenario' || value === '-s') && argv[index + 1]) {
      return String(argv[index + 1]).toLowerCase();
    }
  }

  return '1';
}

function heading(text) {
  console.log(`\n=== ${text} ===`);
}

function subheading(text) {
  console.log(`\n--- ${text} ---`);
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function printJsonBlock(label, value) {
  if (value === undefined) {
    return;
  }
  console.log(`${label}:`);
  console.log(prettyJson(value));
}

function printHttpExchange({ actor, method, url, requestBody, response, note }) {
  console.log(`Actor: ${actor}`);
  console.log(`Request: ${method.toUpperCase()} ${url}`);
  if (requestBody !== undefined) {
    printJsonBlock('Request body', requestBody);
  }
  console.log(`Response status: HTTP ${response.status}`);
  printJsonBlock('Response body', response.body);
  if (note) {
    console.log(`Note: ${note}`);
  }
}

function printObservedEvent(eventType, extra = {}) {
  console.log(`Observed event: ${eventType}`);
  if (Object.keys(extra).length > 0) {
    printJsonBlock('Observed details', extra);
  }
}

async function registerCustomer(customer) {
  const response = await request(`${platform.publicBase}/api/auth/register`, {
    method: 'POST',
    body: customer,
  });

  return { response, customer };
}

async function verifyCustomer(customer, otpCode) {
  const response = await request(`${platform.publicBase}/api/auth/verify-otp`, {
    method: 'POST',
    body: {
      email: customer.email,
      otp_code: otpCode,
    },
  });

  return {
    response,
    session: {
      ...customer,
      token: response.body?.access_token,
      customerId: response.body?.customer?.customer_id,
    },
  };
}

async function bootstrapCustomer(label) {
  const customer = makeCustomer(label);
  const registration = await registerCustomer(customer);
  const otpCode = await waitForLatestOtp(customer.email);
  const verification = await verifyCustomer(customer, otpCode);

  return {
    ...verification.session,
    registration,
    verification,
  };
}

async function createMerchantTransaction(customer, payload) {
  return request(`${platform.publicBase}/api/customer/transactions`, {
    method: 'POST',
    headers: authHeaders(customer.token),
    body: {
      customer_id: customer.customerId,
      sender_name: customer.full_name,
      ...payload,
    },
  });
}

async function getCustomerDecision(customer, transactionId) {
  return request(`${platform.publicBase}/api/customer/transactions/${transactionId}/decision`, {
    headers: authHeaders(customer.token),
  });
}

async function getCustomerAppeals(customer) {
  return request(
    `${platform.publicBase}/api/customer/appeals?customer_id=${encodeURIComponent(customer.customerId)}`,
    {
      headers: authHeaders(customer.token),
    }
  );
}

async function getAuditTrail(transactionId) {
  return request(`${platform.auditBase}/api/v1/audit/transaction/${transactionId}`);
}

async function waitForAuditEvent(transactionId, eventType) {
  return poll(
    `audit event ${eventType} for ${transactionId}`,
    () => getAuditTrail(transactionId),
    (result) => result.status === 200
      && Array.isArray(result.body?.data?.events)
      && result.body.data.events.some((event) => event.eventType === eventType),
    {
      timeoutMs: 120000,
      intervalMs: 2500,
    }
  );
}

async function waitForTransactionStatus(customer, transactionId, expectedStatus) {
  return poll(
    `transaction ${transactionId} -> ${expectedStatus}`,
    () => getCustomerDecision(customer, transactionId),
    (result) => String(result.body?.status || '').toUpperCase() === expectedStatus,
    {
      timeoutMs: 120000,
      intervalMs: 2500,
    }
  );
}

async function waitForFlaggedCase(analystSession, transactionId) {
  return poll(
    `flagged review case ${transactionId}`,
    () => request(`${platform.publicBase}/api/v1/review-cases?status=PENDING,IN_REVIEW&limit=50&offset=0`, {
      headers: authHeaders(analystSession.token),
    }),
    (result) => result.status === 200
      && Array.isArray(result.body?.data)
      && result.body.data.some((item) => item.transactionId === transactionId),
    {
      timeoutMs: 120000,
      intervalMs: 2500,
    }
  );
}

async function waitForPendingAppeal(analystSession, appealId) {
  return poll(
    `pending appeal ${appealId}`,
    () => request(`${platform.publicBase}/api/v1/reviews/appeals/pending?limit=50&offset=0`, {
      headers: authHeaders(analystSession.token),
    }),
    (result) => result.status === 200
      && Array.isArray(result.body?.data)
      && result.body.data.some((item) => item.appealId === appealId),
    {
      timeoutMs: 120000,
      intervalMs: 2500,
    }
  );
}

async function setupScenarioCustomer(label) {
  subheading('Setup');
  console.log('Creating a fresh customer session for this run.');
  const customer = await bootstrapCustomer(label);
  console.log(`Customer email: ${customer.email}`);
  console.log(`Customer ID: ${customer.customerId}`);
  return customer;
}

async function scenarioOne() {
  heading('Scenario 1 - Customer submits a fraudulent transaction');
  const customer = await setupScenarioCustomer('scenario-one');

  const requestBody = {
    merchant_id: 'FTDS_DECLINED_DEMO',
    amount: 100000,
    currency: 'USD',
    card_type: 'PREPAID',
    country: 'NG',
    hour_utc: 2,
  };

  subheading('Step 1 - Customer submits a fraudulent transaction');
  const createResponse = await createMerchantTransaction(customer, requestBody);
  printHttpExchange({
    actor: 'Customer UI -> Transaction',
    method: 'POST',
    url: `${platform.publicBase}/api/customer/transactions`,
    requestBody: {
      customer_id: customer.customerId,
      sender_name: customer.full_name,
      ...requestBody,
    },
    response: createResponse,
  });

  const transactionId = createResponse.body?.transaction_id;
  await waitForAuditEvent(transactionId, 'transaction.created');
  printObservedEvent('transaction.created', { transaction_id: transactionId });

  subheading('Step 2 - Transaction gets scored');
  await waitForAuditEvent(transactionId, 'transaction.scored');
  console.log(`Internal request expected by slide: POST ${platform.fraudScoreBase}/api/v1/score`);
  console.log('Internal response expected by slide: HTTP 200 with fraud score');
  printObservedEvent('transaction.scored', { transaction_id: transactionId });

  subheading('Step 3 - Deciding the outcome of transaction');
  const rejectedDecision = await waitForTransactionStatus(customer, transactionId, 'REJECTED');
  await waitForAuditEvent(transactionId, 'transaction.finalised');
  printObservedEvent('transaction.finalised', {
    transaction_id: transactionId,
    status: rejectedDecision.body?.status,
    fraud_score: rejectedDecision.body?.fraud_score,
    outcome_reason: rejectedDecision.body?.outcome_reason,
  });

  subheading('Step 4 - Customer sees transaction decision');
  printHttpExchange({
    actor: 'Customer UI -> Transaction Decision',
    method: 'GET',
    url: `${platform.publicBase}/api/customer/transactions/${transactionId}/decision`,
    response: rejectedDecision,
  });
}

async function scenarioTwo() {
  heading('Scenario 2 - Customer submits a risky transaction and analyst reviews it');
  const customer = await setupScenarioCustomer('scenario-two');
  const analystSession = await staffLogin(credentials.analyst);

  const requestBody = {
    merchant_id: 'FTDS_FLAGGED_DEMO',
    amount: 50000,
    currency: 'USD',
    card_type: 'PREPAID',
    country: 'NG',
    hour_utc: 2,
  };

  subheading('Step 1 - Customer submits a risky transaction');
  const createResponse = await createMerchantTransaction(customer, requestBody);
  printHttpExchange({
    actor: 'Customer UI -> Transaction',
    method: 'POST',
    url: `${platform.publicBase}/api/customer/transactions`,
    requestBody: {
      customer_id: customer.customerId,
      sender_name: customer.full_name,
      ...requestBody,
    },
    response: createResponse,
  });

  const transactionId = createResponse.body?.transaction_id;
  await waitForAuditEvent(transactionId, 'transaction.created');
  printObservedEvent('transaction.created', { transaction_id: transactionId });

  subheading('Step 2 - Transaction gets scored');
  await waitForAuditEvent(transactionId, 'transaction.scored');
  console.log(`Internal request expected by slide: POST ${platform.fraudScoreBase}/api/v1/score`);
  console.log('Internal response expected by slide: HTTP 200 with fraud score');
  printObservedEvent('transaction.scored', { transaction_id: transactionId });

  subheading('Step 3 - Decision flags the transaction');
  const flaggedDecision = await waitForTransactionStatus(customer, transactionId, 'FLAGGED');
  await waitForAuditEvent(transactionId, 'transaction.flagged');
  printObservedEvent('transaction.flagged', {
    transaction_id: transactionId,
    status: flaggedDecision.body?.status,
    fraud_score: flaggedDecision.body?.fraud_score,
    outcome_reason: flaggedDecision.body?.outcome_reason,
  });

  subheading('Step 4 - Fraud analyst team gets list of flagged cases');
  const pendingCases = await waitForFlaggedCase(analystSession, transactionId);
  printHttpExchange({
    actor: 'Fraud Review Team UI -> Verify flagged cases and appeals',
    method: 'GET',
    url: `${platform.publicBase}/api/v1/review-cases?status=PENDING,IN_REVIEW&limit=50&offset=0`,
    response: pendingCases,
  });

  subheading('Step 5 - Fraud analyst claims flagged case');
  const claimResponse = await request(`${platform.publicBase}/api/v1/review-cases/${transactionId}/claim`, {
    method: 'POST',
    headers: authHeaders(analystSession.token),
    body: { claimTtlMinutes: 5 },
  });
  printHttpExchange({
    actor: 'Fraud Review Team UI -> Verify flagged cases and appeals',
    method: 'POST',
    url: `${platform.publicBase}/api/v1/review-cases/${transactionId}/claim`,
    requestBody: { claimTtlMinutes: 5 },
    response: claimResponse,
  });

  subheading('Step 6 - Fraud analyst submits manual decision');
  const manualDecisionBody = {
    decision: 'APPROVED',
    notes: 'Automated scenario runner approved the flagged case after analyst review.',
  };
  const manualDecisionResponse = await request(`${platform.publicBase}/api/v1/reviews/${transactionId}/decision`, {
    method: 'POST',
    headers: authHeaders(analystSession.token),
    body: manualDecisionBody,
  });
  printHttpExchange({
    actor: 'Fraud Review Team UI -> Verify flagged cases and appeals',
    method: 'POST',
    url: `${platform.publicBase}/api/v1/reviews/${transactionId}/decision`,
    requestBody: manualDecisionBody,
    response: manualDecisionResponse,
  });

  const approvedDecision = await waitForTransactionStatus(customer, transactionId, 'APPROVED');
  await waitForAuditEvent(transactionId, 'transaction.reviewed');
  printObservedEvent('transaction.reviewed', {
    transaction_id: transactionId,
    status: approvedDecision.body?.status,
    fraud_score: approvedDecision.body?.fraud_score,
    outcome_reason: approvedDecision.body?.outcome_reason,
  });

  subheading('Step 7 - Customer sees transaction decision');
  printHttpExchange({
    actor: 'Customer UI -> Transaction Decision',
    method: 'GET',
    url: `${platform.publicBase}/api/customer/transactions/${transactionId}/decision`,
    response: approvedDecision,
  });
}

async function createRejectedTransactionForAppeal(customer) {
  const createResponse = await createMerchantTransaction(customer, {
    merchant_id: 'FTDS_DECLINED_DEMO',
    amount: 100000,
    currency: 'USD',
    card_type: 'PREPAID',
    country: 'NG',
    hour_utc: 2,
  });
  const transactionId = createResponse.body?.transaction_id;
  await waitForTransactionStatus(customer, transactionId, 'REJECTED');
  await waitForAuditEvent(transactionId, 'transaction.finalised');
  return transactionId;
}

async function scenarioThree() {
  heading('Scenario 3 - Customer submits an appeal and fraud team resolves it');
  const customer = await setupScenarioCustomer('scenario-three');
  const analystSession = await staffLogin(credentials.analyst);

  subheading('Setup');
  console.log('Creating a rejected transaction first because the appeal flow needs an existing decision.');
  const transactionId = await createRejectedTransactionForAppeal(customer);
  console.log(`Rejected transaction ready for appeal: ${transactionId}`);

  subheading('Step 1 - Customer submits an appeal');
  const appealBody = {
    transaction_id: transactionId,
    customer_id: customer.customerId,
    reason_for_appeal: 'Customer confirms the transaction is legitimate and requests a reversal.',
    evidence: {
      source: 'scenario-runner',
      note: 'Prepared for slide-based scenario replay.',
    },
  };
  const createAppealResponse = await request(`${platform.publicBase}/api/customer/appeals`, {
    method: 'POST',
    headers: authHeaders(customer.token),
    body: appealBody,
  });
  printHttpExchange({
    actor: 'Customer UI -> Appeal',
    method: 'POST',
    url: `${platform.publicBase}/api/customer/appeals`,
    requestBody: appealBody,
    response: createAppealResponse,
    note: 'The slide shows HTTP 201. The current implementation returns the live status shown above.',
  });

  const appealId = createAppealResponse.body?.appeal_id;
  await waitForAuditEvent(transactionId, 'appeal.created');
  printObservedEvent('appeal.created', { appeal_id: appealId, transaction_id: transactionId });

  subheading('Step 2 - Fraud analyst team gets list of pending appeals');
  const pendingAppeals = await waitForPendingAppeal(analystSession, appealId);
  printHttpExchange({
    actor: 'Fraud Review Team UI -> Verify flagged cases and appeals',
    method: 'GET',
    url: `${platform.publicBase}/api/v1/reviews/appeals/pending?limit=50&offset=0`,
    response: pendingAppeals,
  });

  subheading('Step 3 - Fraud analyst resolves appeal');
  const resolveBody = {
    resolution: 'REVERSE',
    notes: 'Appeal approved by scenario runner to match the slide outcome.',
  };
  const resolveAppealResponse = await request(`${platform.publicBase}/api/v1/reviews/appeals/${appealId}/resolve`, {
    method: 'POST',
    headers: authHeaders(analystSession.token),
    body: resolveBody,
  });
  printHttpExchange({
    actor: 'Fraud Review Team UI -> Verify flagged cases and appeals',
    method: 'POST',
    url: `${platform.publicBase}/api/v1/reviews/appeals/${appealId}/resolve`,
    requestBody: resolveBody,
    response: resolveAppealResponse,
  });

  const approvedDecision = await waitForTransactionStatus(customer, transactionId, 'APPROVED');
  await waitForAuditEvent(transactionId, 'appeal.resolved');
  printObservedEvent('appeal.resolved', {
    appeal_id: appealId,
    transaction_id: transactionId,
    updated_transaction_status: approvedDecision.body?.status,
    outcome_reason: approvedDecision.body?.outcome_reason,
  });

  subheading('Step 4 - Customer views appeal resolution');
  const appealListResponse = await getCustomerAppeals(customer);
  printHttpExchange({
    actor: 'Customer UI -> Appeal',
    method: 'GET',
    url: `${platform.publicBase}/api/customer/appeals?customer_id=${encodeURIComponent(customer.customerId)}`,
    response: appealListResponse,
  });

  printHttpExchange({
    actor: 'Customer UI -> Transaction Decision',
    method: 'GET',
    url: `${platform.publicBase}/api/customer/transactions/${transactionId}/decision`,
    response: approvedDecision,
  });
}

const scenarioMap = {
  '1': scenarioOne,
  '2': scenarioTwo,
  '3': scenarioThree,
};

const scenarioArg = parseScenarioArg(process.argv.slice(2));

await waitForStack();

if (scenarioArg === 'all') {
  for (const key of ['1', '2', '3']) {
    await scenarioMap[key]();
  }
} else if (scenarioMap[scenarioArg]) {
  await scenarioMap[scenarioArg]();
} else {
  console.error(`Unknown scenario "${scenarioArg}". Use 1, 2, 3, or all.`);
  process.exitCode = 1;
}

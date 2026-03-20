import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

export const platform = {
  publicBase: process.env.PUBLIC_BASE_URL || 'http://localhost',
  gatewayBase: process.env.GATEWAY_BASE_URL || 'http://localhost:8004',
  customerBase: process.env.CUSTOMER_BASE_URL || 'http://localhost:8005',
  transactionBase: process.env.TRANSACTION_BASE_URL || 'http://localhost:8000',
  fraudScoreBase: process.env.FRAUD_SCORE_BASE_URL || 'http://localhost:8001',
  detectFraudBase: process.env.DETECT_FRAUD_BASE_URL || 'http://localhost:8008',
  fraudReviewBase: process.env.FRAUD_REVIEW_BASE_URL || 'http://localhost:8002',
  appealBase: process.env.APPEAL_BASE_URL || 'http://localhost:8003',
  analyticsBase: process.env.ANALYTICS_BASE_URL || 'http://localhost:8006',
  auditBase: process.env.AUDIT_BASE_URL || 'http://localhost:8007',
  decisionBase: process.env.DECISION_BASE_URL || 'http://localhost:8009',
  notificationBase: process.env.NOTIFICATION_BASE_URL || 'http://localhost:8010',
};

export const credentials = {
  analyst: {
    username: process.env.ANALYST_USERNAME || 'analyst',
    password: process.env.ANALYST_PASSWORD || 'analyst123',
  },
  manager: {
    username: process.env.MANAGER_USERNAME || 'manager',
    password: process.env.MANAGER_PASSWORD || 'manager123',
  },
};

export const healthChecks = [
  { name: 'customer', url: `${platform.customerBase}/health/ready` },
  { name: 'transaction', url: `${platform.transactionBase}/health/ready` },
  { name: 'fraud-score', url: `${platform.fraudScoreBase}/api/v1/health/ready` },
  { name: 'detect-fraud', url: `${platform.detectFraudBase}/api/v1/health/ready` },
  { name: 'decision', url: `${platform.decisionBase}/api/v1/health/ready` },
  { name: 'fraud-review', url: `${platform.fraudReviewBase}/api/v1/health` },
  { name: 'appeal', url: `${platform.appealBase}/health` },
  { name: 'analytics', url: `${platform.analyticsBase}/health` },
  { name: 'audit', url: `${platform.auditBase}/api/v1/health` },
  { name: 'notification', url: `${platform.notificationBase}/api/v1/health/live` },
  { name: 'gateway', url: `${platform.gatewayBase}/health` },
  { name: 'public-edge', url: `${platform.publicBase}/` },
];

export function logStep(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

export function authHeaders(token, extraHeaders = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
}

export function makeCustomer(prefix) {
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  return {
    email: `${prefix}.${suffix}@example.com`,
    password: `Pass-${suffix}`,
    full_name: `${prefix} ${suffix}`,
    phone: `+6591${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
  };
}

export async function request(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15000,
  } = options;

  const requestHeaders = { ...headers };
  let requestBody = undefined;

  if (body !== undefined) {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    requestBody = requestHeaders['Content-Type'] === 'application/json'
      ? JSON.stringify(body)
      : body;
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      parsed = text;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body: parsed,
    text,
  };
}

export function assertStatus(result, expectedStatus, label) {
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  assert.ok(
    expected.includes(result.status),
    `${label}: expected status ${expected.join(' or ')}, got ${result.status} with body ${JSON.stringify(result.body)}`
  );
  return result;
}

export async function waitForUrl(name, url, options = {}) {
  const {
    timeoutMs = 240000,
    intervalMs = 2000,
    statuses = [200],
  } = options;

  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await request(url, { timeoutMs: Math.min(intervalMs, 10000) });
      if (statuses.includes(result.status)) {
        return result;
      }
      lastError = new Error(`${name} returned ${result.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for ${name} at ${url}: ${lastError?.message || 'unknown error'}`);
}

export async function waitForStack() {
  logStep(`Waiting for ${healthChecks.length} service surfaces to become healthy`);
  const results = [];

  for (const check of healthChecks) {
    await waitForUrl(check.name, check.url);
    results.push(check.name);
    logStep(`Healthy: ${check.name}`);
  }

  return results;
}

export async function poll(name, fn, predicate, options = {}) {
  const {
    timeoutMs = 90000,
    intervalMs = 2000,
  } = options;

  const startedAt = Date.now();
  let lastValue = null;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastValue = await fn();
      if (await predicate(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  if (lastError) {
    throw new Error(`${name}: timed out after error ${lastError.message}`);
  }

  throw new Error(`${name}: timed out waiting for expected state. Last value: ${JSON.stringify(lastValue?.body ?? lastValue)}`);
}

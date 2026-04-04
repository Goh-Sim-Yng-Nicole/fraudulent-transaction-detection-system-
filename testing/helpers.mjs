import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const platform = {
  publicBase: process.env.PUBLIC_BASE_URL || 'https://localhost',
  httpsBase: process.env.HTTPS_BASE_URL || 'https://localhost',
  nginxBase: process.env.NGINX_BASE_URL || 'http://localhost:8088',
  gatewayBase: process.env.GATEWAY_BASE_URL || 'http://localhost:8004',
  customerBase: process.env.CUSTOMER_BASE_URL || 'http://localhost:8005',
  transactionBase: process.env.TRANSACTION_BASE_URL || 'http://localhost:8000',
  fraudScoreBase: process.env.FRAUD_SCORE_BASE_URL || 'http://localhost:8001',
  detectFraudBase: process.env.DETECT_FRAUD_BASE_URL || 'http://localhost:8008',
  fraudReviewBase: process.env.FRAUD_REVIEW_BASE_URL || 'http://localhost:8002',
  appealBase: process.env.APPEAL_BASE_URL || 'http://localhost:8003',
  analyticsBase: process.env.ANALYTICS_BASE_URL || 'http://localhost:8006',
  auditBase: process.env.AUDIT_BASE_URL || 'http://localhost:8007',
  notificationBase: process.env.NOTIFICATION_BASE_URL || 'http://localhost:8010',
  kongAdminBase: process.env.KONG_ADMIN_BASE_URL || 'http://localhost:8090',
  prometheusBase: process.env.PROMETHEUS_BASE_URL || 'http://localhost:9090',
  grafanaBase: process.env.GRAFANA_BASE_URL || 'http://localhost:3000',
  jaegerBase: process.env.JAEGER_BASE_URL || 'http://localhost:16686',
  mailpitBase: process.env.MAILPIT_BASE_URL || 'http://localhost:8025',
  cadvisorBase: process.env.CADVISOR_BASE_URL || 'http://localhost:9091',
};

function shouldUseInsecureTls(url, requestedInsecureTls) {
  if (requestedInsecureTls) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    return ['localhost', '127.0.0.1'].includes(parsedUrl.hostname);
  } catch {
    return requestedInsecureTls;
  }
}

function getAlternateLocalSchemeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (!['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) {
      return null;
    }

    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:';
      return parsedUrl.toString();
    }

    if (parsedUrl.protocol === 'https:') {
      parsedUrl.protocol = 'http:';
      return parsedUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function isTlsSchemeMismatch(error) {
  return error?.cause?.code === 'ERR_SSL_WRONG_VERSION_NUMBER'
    || /wrong version number/i.test(String(error));
}

export const tracing = {
  expectedServices: [
    'analytics',
    'appeal',
    'audit',
    'customer',
    'detect-fraud',
    'fraud-review',
    'fraud-score',
    'gateway',
    'notification',
    'transaction',
  ],
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
  opsReadonly: {
    username: process.env.OPS_READONLY_USERNAME || 'opsviewer',
    password: process.env.OPS_READONLY_PASSWORD || 'opsviewer123',
  },
  opsAdmin: {
    username: process.env.OPS_ADMIN_USERNAME || 'opsadmin',
    password: process.env.OPS_ADMIN_PASSWORD || 'opsadmin123',
  },
};

export const kafka = {
  broker: process.env.REDPANDA_BROKER || 'redpanda:9092',
  requiredTopics: [
    'transaction.created',
    'transaction.scored',
    'transaction.flagged',
    'transaction.finalised',
    'transaction.reviewed',
    'appeal.created',
    'appeal.resolved',
    'analytics.dlq',
    'detect-fraud.dlq',
    'transaction.dlq',
    'transaction.review.dlq',
    'appeal.dlq',
    'notification.dlq',
  ],
  consumerGroups: [
    'detect-fraud-group',
    'transaction-service',
    'human-verification-group',
    'analytics-group',
    'audit-group',
    'notification-group',
  ],
};

export const healthChecks = [
  { name: 'customer', url: `${platform.customerBase}/health/ready` },
  { name: 'transaction', url: `${platform.transactionBase}/health/ready` },
  { name: 'fraud-score', url: `${platform.fraudScoreBase}/api/v1/health/ready` },
  { name: 'detect-fraud', url: `${platform.detectFraudBase}/api/v1/health/ready` },
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

export function basicAuthHeaders(username, password, extraHeaders = {}) {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
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

export function buildFlaggedTransactionPayload({
  customerId,
  senderName,
  recipientCustomerId,
  recipientName,
  amount,
}) {
  return {
    customer_id: customerId,
    sender_name: senderName,
    recipient_customer_id: recipientCustomerId,
    recipient_name: recipientName,
    amount,
    currency: 'USD',
    card_type: 'PREPAID',
    country: 'NG',
    merchant_id: 'FTDS_E2E_MERCHANT',
  };
}

export function assertArrayContains(items, predicate, message) {
  assert.ok(Array.isArray(items), `${message}: expected array payload`);
  assert.ok(items.some(predicate), message);
}

export async function request(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15000,
    redirect = 'follow',
    insecureTls = false,
  } = options;

  const requestHeaders = { ...headers };
  let requestBody;

  if (body !== undefined) {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    requestBody = requestHeaders['Content-Type'] === 'application/json'
      ? JSON.stringify(body)
      : body;
  }

  const fetchOnce = async (targetUrl) => {
    const useInsecureTls = shouldUseInsecureTls(targetUrl, insecureTls);
    const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (useInsecureTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    try {
      const response = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
        redirect,
      });
      const text = await response.text();
      return { response, text };
    } finally {
      if (useInsecureTls) {
        if (originalTlsSetting === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsSetting;
        }
      }
    }
  };

  const alternateSchemeUrl = getAlternateLocalSchemeUrl(url);
  let response;
  let text;

  try {
    ({ response, text } = await fetchOnce(url));
  } catch (error) {
    if (!alternateSchemeUrl || !isTlsSchemeMismatch(error)) {
      throw error;
    }

    ({ response, text } = await fetchOnce(alternateSchemeUrl));
  }

  if (
    alternateSchemeUrl
    && response.status === 400
    && /plain http request was sent to https port/i.test(text)
  ) {
    ({ response, text } = await fetchOnce(alternateSchemeUrl));
  }
  let parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
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

export function assertTextIncludes(result, expectedText, label) {
  assert.ok(
    typeof result.text === 'string' && result.text.includes(expectedText),
    `${label}: expected response text to include ${JSON.stringify(expectedText)}`
  );
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

function formatCommandError(error, command, args) {
  const stdout = error.stdout ? `\nSTDOUT:\n${error.stdout}` : '';
  const stderr = error.stderr ? `\nSTDERR:\n${error.stderr}` : '';
  return new Error(`Command failed: ${command} ${args.join(' ')}${stdout}${stderr}`);
}

export async function runCommand(command, args = [], options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd || workspaceRoot,
      timeout: options.timeoutMs || 120000,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      env: {
        ...process.env,
        ...options.env,
      },
      windowsHide: true,
    });
  } catch (error) {
    throw formatCommandError(error, command, args);
  }
}

export async function dockerCompose(args, options = {}) {
  return runCommand('docker', ['compose', ...args], options);
}

export async function dockerComposeExec(service, commandArgs, options = {}) {
  return dockerCompose(['exec', '-T', service, ...commandArgs], options);
}

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

export async function fetchLatestOtpForEmail(email) {
  const user = process.env.POSTGRES_CUSTOMER_USER || 'postgres';
  const database = process.env.POSTGRES_CUSTOMER_DB || 'ftds_customer';
  const sql = [
    'SELECT o.code',
    'FROM otp_codes o',
    'JOIN customers c ON c.customer_id::text = o.customer_id',
    `WHERE c.email = '${escapeSqlLiteral(email)}'`,
    'AND o.used = false',
    'ORDER BY o.created_at DESC, o.id DESC',
    'LIMIT 1;',
  ].join(' ');

  const { stdout } = await dockerComposeExec('postgres-customer', [
    'psql',
    '-U',
    user,
    '-d',
    database,
    '-t',
    '-A',
    '-c',
    sql,
  ]);

  return stdout.trim();
}

export async function runCustomerSql(sql) {
  const user = process.env.POSTGRES_CUSTOMER_USER || 'postgres';
  const database = process.env.POSTGRES_CUSTOMER_DB || 'ftds_customer';
  return dockerComposeExec('postgres-customer', [
    'psql',
    '-U',
    user,
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-t',
    '-A',
    '-c',
    sql,
  ]);
}

export async function setCustomerPasswordless(customerId) {
  await runCustomerSql(
    `UPDATE customers SET password_hash = NULL WHERE customer_id = '${escapeSqlLiteral(customerId)}';`
  );
}

export async function waitForLatestOtp(email, options = {}) {
  return poll(
    `latest OTP for ${email}`,
    () => fetchLatestOtpForEmail(email),
    (otp) => /^\d{6}$/.test(String(otp || '').trim()),
    {
      timeoutMs: options.timeoutMs || 60000,
      intervalMs: options.intervalMs || 1500,
    }
  );
}

export async function checkHtmlPage(url, label, expectedText, options = {}) {
  const result = await request(url, options);
  assertStatus(result, 200, label);
  assert.ok(result.text?.includes('<html') || result.text?.includes('<!DOCTYPE html'), `${label}: expected HTML page`);
  if (expectedText) {
    assertTextIncludes(result, expectedText, label);
  }
  return result;
}

export function extractSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const singleHeader = headers.get('set-cookie');
  return singleHeader ? [singleHeader] : [];
}

export function toCookieHeader(setCookieHeaders = []) {
  return setCookieHeaders
    .map((header) => String(header).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

export async function staffLogin(credentialsSet, options = {}) {
  const loginResult = await request(`${options.baseUrl || platform.publicBase}/api/staff/login`, {
    method: 'POST',
    body: credentialsSet,
  });

  assertStatus(loginResult, 200, `staff login ${credentialsSet.username}`);
  const cookie = toCookieHeader(extractSetCookieHeaders(loginResult.headers));
  assert.ok(cookie, `staff login ${credentialsSet.username}: missing session cookie`);
  assert.ok(loginResult.body?.access_token, `staff login ${credentialsSet.username}: missing access token`);

  return {
    token: loginResult.body.access_token,
    cookie,
    user: loginResult.body.user,
  };
}

export async function listKafkaTopics() {
  const { stdout } = await dockerComposeExec('redpanda', [
    'rpk',
    'topic',
    'list',
    '--brokers',
    kafka.broker,
  ]);

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .slice(1)
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

async function rerunKafkaInit() {
  await dockerCompose(['up', '--force-recreate', '--abort-on-container-exit', 'kafka-init'], {
    timeoutMs: 180000,
  });
}

export async function assertKafkaTopicsPresent(expectedTopics = kafka.requiredTopics) {
  let topics = await listKafkaTopics();
  let missingTopics = expectedTopics.filter((topic) => !topics.includes(topic));

  if (missingTopics.length > 0) {
    await rerunKafkaInit();
    topics = await listKafkaTopics();
    missingTopics = expectedTopics.filter((topic) => !topics.includes(topic));
  }

  for (const topic of expectedTopics) {
    assert.ok(topics.includes(topic), `Kafka topic ${topic} should exist. Found: ${topics.join(', ')}`);
  }

  return topics;
}

function parseLagValue(raw) {
  if (!raw || raw === '-') {
    return 0;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function parseConsumerGroupDescribe(text) {
  const totalLagMatch = text.match(/TOTAL-LAG\s+([^\s]+)/);
  const stateMatch = text.match(/STATE\s+([^\s]+)/);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const tableStart = lines.findIndex((line) => line.startsWith('TOPIC'));
  const partitions = tableStart === -1
    ? []
    : lines.slice(tableStart + 1).map((line) => {
      const [topic, partition, currentOffset, logStartOffset, logEndOffset, lag, memberId, clientId, host] = line.split(/\s{2,}/);
      return {
        topic,
        partition: Number(partition),
        currentOffset,
        logStartOffset,
        logEndOffset,
        lag: parseLagValue(lag),
        memberId,
        clientId,
        host,
      };
    });

  return {
    state: stateMatch?.[1] || 'UNKNOWN',
    totalLag: parseLagValue(totalLagMatch?.[1]),
    partitions,
    raw: text,
  };
}

export async function describeConsumerGroup(group) {
  const { stdout } = await dockerComposeExec('redpanda', [
    'rpk',
    'group',
    'describe',
    group,
    '--brokers',
    kafka.broker,
  ]);

  return parseConsumerGroupDescribe(stdout);
}

export async function waitForConsumerGroupSettled(group, options = {}) {
  return poll(
    `consumer group ${group} settled`,
    () => describeConsumerGroup(group),
    (result) => result.state === 'Stable' && result.totalLag === 0,
    {
      timeoutMs: options.timeoutMs || 120000,
      intervalMs: options.intervalMs || 2000,
    }
  );
}

export async function waitForConsumerGroupsSettled(groups = kafka.consumerGroups, options = {}) {
  const settled = {};
  for (const group of groups) {
    settled[group] = await waitForConsumerGroupSettled(group, options);
  }
  return settled;
}

export async function listJaegerServices(headers = {}) {
  const result = await request(`${platform.jaegerBase}/api/services`, { headers });
  assertStatus(result, 200, 'jaeger services');
  assert.ok(Array.isArray(result.body?.data), 'jaeger services should return an array');
  return result.body.data;
}

export async function waitForJaegerServices(expectedServices = tracing.expectedServices, options = {}, headers = {}) {
  return poll(
    'jaeger services include expected application services',
    () => listJaegerServices(headers),
    (services) => expectedServices.every((service) => services.includes(service)),
    {
      timeoutMs: options.timeoutMs || 120000,
      intervalMs: options.intervalMs || 2500,
    }
  );
}

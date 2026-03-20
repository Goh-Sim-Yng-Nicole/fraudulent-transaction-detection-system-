'use strict';

const express = require('express');
const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');
const { authenticate } = require('../middleware/auth');
const { transactionLimiter, standardLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const serviceRoutes = [
  {
    pathPrefix: '/auth',
    target: config.services.user,
    serviceName: 'user-service',
    enabled: config.routeToggles.auth,
    useTransactionLimiter: false,
    requireGatewayAuth: false,
    rewriteTo: '',
  },
  {
    pathPrefix: '/transactions',
    target: config.services.transaction,
    serviceName: 'transaction-service',
    enabled: config.routeToggles.transactions,
    useTransactionLimiter: true,
    rewriteTo: '/api/v1/transactions',
  },
  {
    pathPrefix: '/audit',
    target: config.services.audit,
    serviceName: 'audit-service',
    enabled: config.routeToggles.audit,
    useTransactionLimiter: false,
    rewriteTo: '/api/v1/audit',
  },
  {
    pathPrefix: '/decisions',
    target: config.services.decisionEngine,
    serviceName: 'decision-engine-service',
    enabled: config.routeToggles.decisions,
    useTransactionLimiter: false,
    rewriteTo: '/api/v1/decisions',
  },
  {
    pathPrefix: '/thresholds',
    target: config.services.decisionEngine,
    serviceName: 'decision-engine-service',
    enabled: config.routeToggles.decisions,
    useTransactionLimiter: false,
    rewriteTo: '/api/v1/thresholds',
  },
  {
    pathPrefix: '/analytics',
    target: config.services.analytics,
    serviceName: 'analytics-service',
    enabled: config.routeToggles.analytics,
    useTransactionLimiter: false,
    rewriteTo: '/api/v1/analytics',
  },
  {
    pathPrefix: '/reviews',
    target: config.services.humanVerification,
    serviceName: 'human-verification-service',
    enabled: config.routeToggles.humanVerification,
    useTransactionLimiter: false,
    rewriteTo: '/api/v1/reviews',
  },
  {
    pathPrefix: '/review-cases',
    target: config.services.humanVerification,
    serviceName: 'human-verification-service',
    enabled: config.routeToggles.humanVerification,
    useTransactionLimiter: false,
    rewriteTo: '/api/v1/review-cases',
  },
  {
    pathPrefix: '/appeals',
    target: config.services.appeal,
    serviceName: 'appeal-service',
    enabled: config.routeToggles.appeals,
    useTransactionLimiter: false,
    rewriteTo: '/api/v1/appeals',
  },
];

const makeProxyHandler = (target, serviceName, rewriteTo) => async (req, res) => {
  const subPath = req.path === '/' ? '' : req.path;
  const targetUrl = `${target}${rewriteTo}${subPath}`;
  const startTime = Date.now();

  logger.debug('Proxying request', {
    requestId: req.requestId,
    method: req.method,
    targetUrl,
    serviceName,
  });

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: ['GET', 'HEAD', 'DELETE'].includes(req.method.toUpperCase()) ? undefined : req.body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.authorization || '',
        'X-Request-ID': req.requestId || '',
        'X-Correlation-ID': req.correlationId || '',
        'X-User-ID': req.user?.userId || '',
        'X-User-Role': req.user?.role || '',
        'X-Idempotency-Key': req.idempotencyKey || '',
        'X-Forwarded-For': req.ip || '',
      },
      timeout: config.proxy.timeout || 30000,
      validateStatus: () => true,
      maxRedirects: 0,
    });

    logger.debug('Proxy response received', {
      requestId: req.requestId,
      statusCode: response.status,
      serviceName,
      durationMs: Date.now() - startTime,
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    logger.error('Proxy request failed', {
      requestId: req.requestId,
      error: err.message,
      code: err.code,
      serviceName,
      targetUrl,
      durationMs: Date.now() - startTime,
    });

    if (res.headersSent) {
      return;
    }

    const status = (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') ? 504 : 503;
    res.status(status).json({
      success: false,
      error: {
        message: `Service ${serviceName} is currently unavailable`,
        statusCode: status,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }
};

serviceRoutes.forEach((route) => {
  if (route.enabled === false) {
    logger.info(`Proxy skipped: ${route.pathPrefix} disabled by configuration`);
    return;
  }

  const rateLimiter = route.useTransactionLimiter ? transactionLimiter : standardLimiter;
  const handler = makeProxyHandler(route.target, route.serviceName, route.rewriteTo);
  const middleware = route.requireGatewayAuth === false
    ? [rateLimiter, handler]
    : [authenticate, rateLimiter, handler];

  router.use(route.pathPrefix, ...middleware);

  logger.info(`Proxy registered: ${route.pathPrefix} -> ${route.target}${route.rewriteTo}`);
});

module.exports = router;

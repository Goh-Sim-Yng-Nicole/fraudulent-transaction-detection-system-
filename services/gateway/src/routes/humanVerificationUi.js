const express = require('express');
const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');

const router = express.Router();

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const copyHeaders = (source = {}) => Object.entries(source).reduce((acc, [key, value]) => {
  if (!hopByHopHeaders.has(key.toLowerCase())) {
    acc[key] = value;
  }
  return acc;
}, {});

router.use('/', async (req, res) => {
  const upstreamPath = req.path === '/' ? '/' : req.path;
  const targetUrl = `${config.services.humanVerification}${upstreamPath}`;

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : req.body,
      headers: {
        ...copyHeaders(req.headers),
        'x-forwarded-for': req.ip || '',
        'x-request-id': req.requestId || '',
        'x-correlation-id': req.correlationId || '',
      },
      responseType: 'arraybuffer',
      timeout: config.proxy.timeout,
      validateStatus: () => true,
    });

    Object.entries(copyHeaders(response.headers)).forEach(([key, value]) => {
      if (value !== undefined) {
        res.setHeader(key, value);
      }
    });

    res.status(response.status).send(response.data);
  } catch (error) {
    logger.error('Human verification UI proxy failed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      error: error.message,
      code: error.code,
    });

    res.status(503).json({
      success: false,
      error: {
        message: 'Human verification UI is currently unavailable',
        statusCode: 503,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }
});

module.exports = router;

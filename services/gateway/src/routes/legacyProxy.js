const express = require('express');
const axios = require('axios');
const config = require('../config');

const router = express.Router();

const request = async (req, method, target, { body, params } = {}) => {
  return axios({
    method,
    url: target,
    data: body,
    params,
    headers: {
      Authorization: req.headers.authorization || '',
      'X-Request-ID': req.requestId || '',
      'X-Correlation-ID': req.correlationId || '',
      'X-Forwarded-For': req.ip || '',
    },
    timeout: config.proxy.timeout,
    validateStatus: () => true,
  });
};

const send = async (req, res, method, target, options, transform) => {
  const response = await request(req, method, target, options);
  const payload = transform ? transform(response.data, response.status) : response.data;
  return res.status(response.status).json(payload);
};

const unwrapData = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data;
  }
  return payload;
};

router.post('/auth/register', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.user}/register`,
    { body: req.body },
    (payload) => payload
  );
});

router.post('/auth/login', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.user}/login`,
    { body: req.body },
    (payload) => payload
  );
});

router.get('/customers/lookup', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ detail: 'query is required' });
  }

  await send(
    req,
    res,
    'GET',
    `${config.services.user}/lookup`,
    { params: { query } }
  );
});

router.get('/customers/me', async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.user}/me`
  );
});

router.put('/customers/me', async (req, res) => {
  await send(
    req,
    res,
    'PUT',
    `${config.services.user}/me`,
    { body: req.body }
  );
});

router.put('/customers/me/password', async (req, res) => {
  await send(
    req,
    res,
    'PUT',
    `${config.services.user}/me/password`,
    { body: req.body }
  );
});

router.post('/customers/me/request-otp', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.user}/me/request-otp`
  );
});

router.delete('/customers/me', async (req, res) => {
  await send(
    req,
    res,
    'DELETE',
    `${config.services.user}/me`,
    { body: req.body }
  );
});

router.get('/customer/transactions', async (req, res) => {
  const customerId = req.query.customer_id || req.query.customerId;
  if (!customerId) {
    return res.status(400).json({ detail: 'customer_id is required' });
  }

  await send(
    req,
    res,
    'GET',
    `${config.services.transaction}/transactions`,
    { params: { customer_id: customerId, direction: req.query.direction || 'all' } }
  );
});

router.post('/customer/transactions', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.transaction}/transactions`,
    { body: req.body }
  );
});

router.get('/customer/transactions/:transactionId', async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.transaction}/transactions/${encodeURIComponent(req.params.transactionId)}`
  );
});

router.get('/customer/transactions/:transactionId/decision', async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.transaction}/transactions/${encodeURIComponent(req.params.transactionId)}/decision`
  );
});

router.get('/customer/appeals', async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.appeal}/appeals`,
    { params: { customer_id: req.query.customer_id || req.query.customerId } }
  );
});

router.post('/customer/appeals', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.appeal}/appeals`,
    { body: req.body }
  );
});

router.get('/customer/appeals/:appealId', async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.appeal}/appeals/${encodeURIComponent(req.params.appealId)}`
  );
});

router.post('/fraud/login', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/login`,
    { body: req.body }
  );
});

router.get('/fraud/flagged', async (req, res) => {
  await send(req, res, 'GET', `${config.services.humanVerification}/flagged`);
});

router.post('/fraud/flagged/:transactionId/resolve', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/flagged/${encodeURIComponent(req.params.transactionId)}/resolve`,
    { body: req.body }
  );
});

router.get('/fraud/appeals', async (req, res) => {
  await send(req, res, 'GET', `${config.services.humanVerification}/appeals`);
});

router.post('/fraud/appeals/:appealId/resolve', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/appeals/${encodeURIComponent(req.params.appealId)}/resolve`,
    { body: req.body }
  );
});

module.exports = router;

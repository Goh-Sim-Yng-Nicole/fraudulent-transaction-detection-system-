const express = require('express');
const axios = require('axios');
const config = require('../config');
const { authenticate, authorize } = require('../middleware/auth');
const recipientDirectoryService = require('../services/recipientDirectoryService');

const router = express.Router();

router.use((req, _res, next) => {
  if (String(req.originalUrl || '').startsWith('/api/v1/')) {
    return next('router');
  }
  return next();
});

const customerOnly = [authenticate, authorize('customer')];
const fraudStaffOnly = [authenticate, authorize('fraud_analyst', 'fraud_manager')];
const analyticsStaffOnly = [authenticate, authorize('fraud_manager', 'ops_readonly', 'ops_admin')];

const getRecipientDirectoryOwnerId = (req) => req.customerProfile?.customer_id || req.user?.userId || '';

const ensureRecipientDirectoryConfigured = (res) => {
  if (recipientDirectoryService.isConfigured()) {
    return true;
  }

  res.status(503).json({
    error: 'Saved recipients are not configured for this environment yet.',
  });
  return false;
};

const request = async (req, method, target, { body, params } = {}) => {
  return axios({
    method,
    url: target,
    data: body,
    params,
    headers: {
      Authorization: req.headers.authorization || (req.token ? `Bearer ${req.token}` : ''),
      'X-Request-ID': req.requestId || '',
      'X-Correlation-ID': req.correlationId || '',
      'X-User-ID': req.user?.userId || '',
      'X-User-Role': req.user?.role || '',
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

const requireCustomerLocalPassword = async (req, res, next) => {
  try {
    const response = await request(req, 'GET', `${config.services.user}/me`);
    if (response.status !== 200) {
      return res.status(response.status).json(response.data);
    }

    if (response.data?.has_password === false) {
      return res.status(428).json({
        error: 'Set a local password before making changes to this account',
      });
    }

    req.customerProfile = response.data;
    return next();
  } catch (error) {
    return next(error);
  }
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

router.get('/customers/lookup', ...customerOnly, async (req, res) => {
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

router.get('/customers/me', ...customerOnly, async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.user}/me`
  );
});

router.get('/customer/recipients', ...customerOnly, async (req, res, next) => {
  if (!ensureRecipientDirectoryConfigured(res)) {
    return;
  }

  try {
    const result = await recipientDirectoryService.listRecipients(
      getRecipientDirectoryOwnerId(req),
      req.query.favorites_only
    );
    return res.status(result.status).json(result.data);
  } catch (error) {
    return next(error);
  }
});

router.get('/customer/recipients/:recipientId', ...customerOnly, async (req, res, next) => {
  if (!ensureRecipientDirectoryConfigured(res)) {
    return;
  }

  try {
    const result = await recipientDirectoryService.getRecipient(
      getRecipientDirectoryOwnerId(req),
      req.params.recipientId
    );
    return res.status(result.status).json(result.data);
  } catch (error) {
    return next(error);
  }
});

router.post('/customer/recipients', ...customerOnly, requireCustomerLocalPassword, async (req, res, next) => {
  if (!ensureRecipientDirectoryConfigured(res)) {
    return;
  }

  try {
    const result = await recipientDirectoryService.createRecipient(
      getRecipientDirectoryOwnerId(req),
      req.body
    );
    return res.status(result.status).json(result.data);
  } catch (error) {
    return next(error);
  }
});

router.put('/customer/recipients/:recipientId', ...customerOnly, requireCustomerLocalPassword, async (req, res, next) => {
  if (!ensureRecipientDirectoryConfigured(res)) {
    return;
  }

  try {
    const result = await recipientDirectoryService.updateRecipient(
      getRecipientDirectoryOwnerId(req),
      req.params.recipientId,
      req.body
    );
    return res.status(result.status).json(result.data);
  } catch (error) {
    return next(error);
  }
});

router.delete('/customer/recipients/:recipientId', ...customerOnly, requireCustomerLocalPassword, async (req, res, next) => {
  if (!ensureRecipientDirectoryConfigured(res)) {
    return;
  }

  try {
    const result = await recipientDirectoryService.deleteRecipient(
      getRecipientDirectoryOwnerId(req),
      req.params.recipientId
    );
    return res.status(result.status).json(result.data);
  } catch (error) {
    return next(error);
  }
});

router.put('/customers/me', ...customerOnly, requireCustomerLocalPassword, async (req, res) => {
  await send(
    req,
    res,
    'PUT',
    `${config.services.user}/me`,
    { body: req.body }
  );
});

router.put('/customers/me/password', ...customerOnly, requireCustomerLocalPassword, async (req, res) => {
  await send(
    req,
    res,
    'PUT',
    `${config.services.user}/me/password`,
    { body: req.body }
  );
});

router.post('/customers/me/password/set', ...customerOnly, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.user}/me/password/set`,
    { body: req.body }
  );
});

router.post('/customers/me/request-otp', ...customerOnly, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.user}/me/request-otp`
  );
});

router.delete('/customers/me', ...customerOnly, requireCustomerLocalPassword, async (req, res) => {
  await send(
    req,
    res,
    'DELETE',
    `${config.services.user}/me`,
    { body: req.body }
  );
});

router.get('/customer/transactions', ...customerOnly, async (req, res) => {
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

router.post('/customer/transactions', ...customerOnly, requireCustomerLocalPassword, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.transaction}/transactions`,
    { body: req.body }
  );
});

router.get('/customer/transactions/:transactionId', ...customerOnly, async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.transaction}/transactions/${encodeURIComponent(req.params.transactionId)}`
  );
});

router.get('/customer/transactions/:transactionId/decision', ...customerOnly, async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.transaction}/transactions/${encodeURIComponent(req.params.transactionId)}/decision`
  );
});

router.get('/customer/appeals', ...customerOnly, async (req, res) => {
  await send(
    req,
    res,
    'GET',
    `${config.services.appeal}/appeals`,
    { params: { customer_id: req.query.customer_id || req.query.customerId } }
  );
});

router.post('/customer/appeals', ...customerOnly, requireCustomerLocalPassword, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.appeal}/appeals`,
    { body: req.body }
  );
});

router.get('/customer/appeals/:appealId', ...customerOnly, async (req, res) => {
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

router.get('/fraud/flagged', ...fraudStaffOnly, async (req, res) => {
  await send(req, res, 'GET', `${config.services.humanVerification}/flagged`);
});

router.post('/fraud/flagged/:transactionId/resolve', ...fraudStaffOnly, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/flagged/${encodeURIComponent(req.params.transactionId)}/resolve`,
    { body: req.body }
  );
});

router.get('/fraud/appeals', ...fraudStaffOnly, async (req, res) => {
  await send(req, res, 'GET', `${config.services.humanVerification}/appeals`);
});

router.post('/fraud/appeals/:appealId/resolve', ...fraudStaffOnly, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/appeals/${encodeURIComponent(req.params.appealId)}/resolve`,
    { body: req.body }
  );
});

router.post('/fraud-review/login', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/login`,
    { body: req.body },
    (payload) => payload
  );
});

router.get('/fraud-review/flagged', ...fraudStaffOnly, async (req, res) => {
  await send(req, res, 'GET', `${config.services.humanVerification}/flagged`);
});

router.post('/fraud-review/flagged/:transactionId/resolve', ...fraudStaffOnly, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/flagged/${encodeURIComponent(req.params.transactionId)}/resolve`,
    { body: req.body }
  );
});

router.get('/fraud-review/appeals', ...fraudStaffOnly, async (req, res) => {
  await send(req, res, 'GET', `${config.services.humanVerification}/appeals`);
});

router.post('/fraud-review/appeals/:appealId/resolve', ...fraudStaffOnly, async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.humanVerification}/appeals/${encodeURIComponent(req.params.appealId)}/resolve`,
    { body: req.body }
  );
});

router.post('/analytics/login', async (req, res) => {
  await send(
    req,
    res,
    'POST',
    `${config.services.analytics}/login`,
    { body: req.body },
    (payload) => payload
  );
});

router.get('/analytics/dashboard', ...analyticsStaffOnly, async (req, res) => {
  await send(req, res, 'GET', `${config.services.analytics}/dashboard`);
});

module.exports = router;

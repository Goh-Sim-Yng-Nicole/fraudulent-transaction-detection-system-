const express = require('express');
const appealService = require('../services/appealService');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/appeals', async (req, res) => {
  const customerId = req.query.customer_id || req.query.customerId;
  if (!customerId) {
    return res.status(400).json({ detail: 'customer_id is required' });
  }

  const data = await appealService.listByCustomer(String(customerId), 100, 0);
  return res.json(data.map((item) => ({
    appeal_id: item.appealId,
    transaction_id: item.transactionId,
    reason_for_appeal: item.appealReason,
    status: item.currentStatus,
    manual_outcome: item.resolution === 'REVERSE' ? 'APPROVED' : item.resolution === 'UPHOLD' ? 'REJECTED' : null,
    outcome_reason: item.resolutionNotes,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  })));
});

router.post('/appeals', async (req, res, next) => {
  try {
    const data = await appealService.createAppeal({
      transactionId: req.body.transaction_id || req.body.transactionId,
      customerId: req.body.customer_id || req.body.customerId,
      appealReason: req.body.reason_for_appeal || req.body.appealReason,
      evidence: req.body.evidence,
      correlationId: req.headers['x-correlation-id'] || null,
      authHeader: req.headers.authorization || null,
    });

    return res.json({
      appeal_id: data.appealId,
      status: data.currentStatus || 'PENDING',
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/appeals/:appealId', async (req, res) => {
  const data = await appealService.getByAppealId(req.params.appealId);
  if (!data) {
    return res.status(404).json({ detail: 'appeal not found' });
  }

  const response = {
    appeal: {
      appeal_id: data.appealId,
      transaction_id: data.transactionId,
      reason_for_appeal: data.appealReason,
    },
    status: data.currentStatus,
  };

  if (String(data.currentStatus).toUpperCase() === 'RESOLVED') {
    response.resolution = {
      manual_outcome: data.resolution === 'REVERSE' ? 'APPROVED' : 'REJECTED',
      outcome_reason: data.resolutionNotes,
    };
  }

  return res.json(response);
});

module.exports = router;

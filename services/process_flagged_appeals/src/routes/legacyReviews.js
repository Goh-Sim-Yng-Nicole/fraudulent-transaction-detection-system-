const express = require('express');
const config = require('../config');
const reviewService = require('../services/reviewService');
const appealReviewService = require('../services/appealReviewService');
const { authenticateStaff } = require('../middleware/staffAuth');

const router = express.Router();
const requireAnalyst = authenticateStaff(['fraud_analyst', 'fraud_manager']);

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== config.analyst.username || password !== config.analyst.password) {
    return res.status(401).json({ detail: 'invalid credentials' });
  }

  return res.json({
    access_token: config.analyst.token,
    token_type: 'bearer',
  });
});

router.get('/flagged', requireAnalyst, async (_req, res) => {
  const data = await reviewService.listPending(100, 0);
  return res.json(data.map((item) => ({
    transaction_id: item.transactionId,
    rules_score: item.riskScore ?? item.ruleScore ?? 0,
      reason: item.reviewReason || item.decisionReason || 'Manual review required',
      status: item.finalDecision || item.queueStatus,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    })));
});

router.post('/flagged/:transactionId/resolve', requireAnalyst, async (req, res, next) => {
  try {
    const outcome = String(req.body.manual_outcome || '').toUpperCase();
    const decision = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'REJECTED' ? 'DECLINED' : null;
    if (!decision) {
      return res.status(400).json({ detail: 'invalid request' });
    }

    await reviewService.applyDecision({
      transactionId: req.params.transactionId,
      decision,
      reviewedBy: req.staff?.userId || config.analyst.username,
      reviewedRole: req.staff?.role || 'fraud_analyst',
      notes: req.body.reason || req.body.notes || null,
    });

    return res.json({ status: 'submitted' });
  } catch (err) {
    return next(err);
  }
});

router.get('/appeals', requireAnalyst, async (req, res, next) => {
  try {
    const data = await appealReviewService.listPendingAppeals({
      limit: 100,
      offset: 0,
      authHeader: req.headers.authorization || null,
      correlationId: req.headers['x-correlation-id'] || null,
    });

    return res.json(data.map((item) => ({
      appeal_id: item.appealId,
      transaction_id: item.transactionId,
      reason_for_appeal: item.appealReason,
      status: item.currentStatus,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    })));
  } catch (err) {
    return next(err);
  }
});

router.post('/appeals/:appealId/resolve', requireAnalyst, async (req, res, next) => {
  try {
    const outcome = String(req.body.manual_outcome || '').toUpperCase();
    const resolution = outcome === 'APPROVED' ? 'REVERSE' : outcome === 'REJECTED' ? 'UPHOLD' : null;
    if (!resolution) {
      return res.status(400).json({ detail: 'invalid request' });
    }

    await appealReviewService.resolveAppeal({
      appealId: req.params.appealId,
      resolution,
      reviewedBy: req.staff?.userId || config.analyst.username,
      reviewedRole: req.staff?.role || 'fraud_analyst',
      notes: req.body.outcome_reason || req.body.notes || null,
      authHeader: req.headers.authorization || null,
      correlationId: req.headers['x-correlation-id'] || null,
    });

    return res.json({ status: 'submitted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

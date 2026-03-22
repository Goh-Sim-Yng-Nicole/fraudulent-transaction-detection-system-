const router = require('express').Router();
const config = require('../config');
const projectionStore = require('../services/projectionStore');
const { authenticateStaff } = require('../middleware/staffAuth');

const requireAnalyticsStaff = authenticateStaff(['fraud_manager', 'ops_readonly', 'ops_admin']);

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== config.manager.username || password !== config.manager.password) {
    return res.status(401).json({ detail: 'invalid credentials' });
  }

  return res.json({
    access_token: config.manager.token,
    token_type: 'bearer',
  });
});

router.get('/dashboard', requireAnalyticsStaff, async (_req, res) => {
  const [transactions, appeals] = await Promise.all([
    projectionStore.listTransactions(),
    projectionStore.listAppeals(),
  ]);

  const approvedTransactions = transactions.filter((record) => record.decision === 'APPROVED');
  const declinedTransactions = transactions.filter((record) => record.decision === 'DECLINED');
  const flaggedTransactions = transactions.filter((record) => record.decision === 'FLAGGED');
  const reviewedTransactions = transactions.filter((record) => record.manualReview?.applied);
  const resolvedAppeals = appeals.filter((record) => String(record.currentStatus).toUpperCase() === 'RESOLVED');

  const approvedAppeals = resolvedAppeals.filter((record) => String(record.resolution || record.outcome).toUpperCase() === 'REVERSE');
  const rejectedAppeals = resolvedAppeals.filter((record) => String(record.resolution || record.outcome).toUpperCase() === 'UPHOLD');

  return res.json({
    updated_at: new Date().toISOString(),
    transactions_approved: approvedTransactions.length,
    transactions_rejected: declinedTransactions.length,
    transactions_flagged: flaggedTransactions.length,
    transactions_reviewed: reviewedTransactions.length,
    appeals_created: appeals.length,
    appeals_approved: approvedAppeals.length,
    appeals_rejected: rejectedAppeals.length,
    total_approved_amount: approvedTransactions.reduce((sum, record) => sum + (Number(record.amount) || 0), 0),
    total_rejected_amount: declinedTransactions.reduce((sum, record) => sum + (Number(record.amount) || 0), 0),
  });
});

module.exports = router;

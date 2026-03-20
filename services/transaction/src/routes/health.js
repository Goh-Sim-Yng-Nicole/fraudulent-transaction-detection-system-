const router = require('express').Router();
const { getPool } = require('../db/pool');

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/health/ready', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', detail: error.message });
  }
});

module.exports = router;

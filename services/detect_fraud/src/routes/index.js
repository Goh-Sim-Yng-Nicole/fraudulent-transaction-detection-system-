const router = require('express').Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/health/ready', (_req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;

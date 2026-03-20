const router = require('express').Router();
const { register } = require('../utils/metrics');
const config = require('../config');

/**
 * @openapi
 * /api/v1/metrics:
 *   get:
 *     tags: [notification-service]
 *     summary: Prometheus metrics endpoint
 *     responses:
 *       200:
 *         description: Metrics payload
 *       404:
 *         description: Metrics disabled
 */
// Handles GET /metrics.
router.get('/metrics', async (req, res) => {
  if (!config.metrics.enabled) {
    return res.status(404).json({ error: 'Metrics disabled' });
  }

  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

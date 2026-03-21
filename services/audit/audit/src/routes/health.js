const router = require('express').Router();
const { query } = require('../db/pool');

/**
 * @openapi
 * /api/v1/health:
 *   get:
 *     tags: [audit-service]
 *     summary: Service health status
 *     responses:
 *       200:
 *         description: Service healthy
 *       503:
 *         description: Service degraded/unhealthy
 */
// Handles GET /health.
router.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'audit-service',
    uptime: Math.floor(process.uptime()),
    dependencies: {},
  };

  let degraded = false;
  try {
    await query('SELECT 1');
    health.dependencies.database = { status: 'healthy' };
  } catch (err) {
    health.dependencies.database = { status: 'unhealthy', error: err.message };
    degraded = true;
  }
  health.dependencies.kafka = {
    status: 'healthy',
    note: 'Consumer crash triggers process restart',
  };

  health.status = degraded ? 'degraded' : 'healthy';
  res.status(degraded ? 503 : 200).json(health);
});

/**
 * @openapi
 * /api/v1/health/live:
 *   get:
 *     tags: [audit-service]
 *     summary: Liveness probe
 *     responses:
 *       200:
 *         description: Process alive
 */
// Handles GET /health/live.
router.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

module.exports = router;

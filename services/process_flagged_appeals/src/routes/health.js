const express = require('express');
const { getPool } = require('../db/pool');

const router = express.Router();

/**
 * @openapi
 * /api/v1/health/live:
 *   get:
 *     tags: [human-verification-service]
 *     summary: Liveness probe
 *     responses:
 *       200:
 *         description: Process alive
 */
router.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'alive', service: 'human-verification-service' });
});

/**
 * @openapi
 * /api/v1/health:
 *   get:
 *     tags: [human-verification-service]
 *     summary: Service health status
 *     responses:
 *       200:
 *         description: Service healthy
 *       503:
 *         description: Service unhealthy
 */
router.get('/health', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.status(200).json({
      status: 'healthy',
      service: 'human-verification-service',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'human-verification-service',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;

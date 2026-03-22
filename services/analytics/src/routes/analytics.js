const router = require('express').Router();
const analyticsController = require('./analyticsController');
/**
 * @openapi
 * /api/v1/analytics/dashboard:
 *   get:
 *     tags: [analytics-service]
 *     summary: Get dashboard metrics
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dashboard metrics returned
 */
// Handles GET /analytics/dashboard.
router.get('/analytics/dashboard', analyticsController.getDashboard);
/**
 * @openapi
 * /api/v1/analytics/realtime:
 *   get:
 *     tags: [analytics-service]
 *     summary: Get realtime analytics snapshot
 *     responses:
 *       200:
 *         description: Realtime metrics returned
 */
// Handles GET /analytics/realtime.
router.get('/analytics/realtime', analyticsController.getRealTime);

module.exports = router;

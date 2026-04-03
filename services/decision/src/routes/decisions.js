const router = require('express').Router();
const decisionController = require('../controllers/decisionController');
/**
 * @openapi
 * /api/v1/decisions/stats:
 *   get:
 *     tags: [decision-service]
 *     summary: Get decision statistics
 *     responses:
 *       200:
 *         description: Decision stats returned
 */
// Handles GET /decisions/stats.
router.get('/decisions/stats', decisionController.getStats);
/**
 * @openapi
 * /api/v1/decisions/{transactionId}:
 *   get:
 *     tags: [decision-service]
 *     summary: Get decision by transaction id
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Decision returned
 *       404:
 *         description: Decision not found
 */
// Handles GET /decisions/:transactionId.
router.get('/decisions/:transactionId', decisionController.getDecisionByTransaction);
/**
 * @openapi
 * /api/v1/thresholds:
 *   get:
 *     tags: [decision-service]
 *     summary: Get active decision thresholds
 *     responses:
 *       200:
 *         description: Threshold configuration returned
 */
// Handles GET /thresholds.
router.get('/thresholds', decisionController.getThresholds);

module.exports = router;


const express = require('express');
const controller = require('../controllers/appealController');

const router = express.Router();

/**
 * @openapi
 * /api/v1/appeals:
 *   post:
 *     tags: [appeal-service]
 *     summary: Create customer appeal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionId, customerId, appealReason]
 *             properties:
 *               transactionId:
 *                 type: string
 *               customerId:
 *                 type: string
 *               appealReason:
 *                 type: string
 *               evidence:
 *                 type: object
 *     responses:
 *       201:
 *         description: Appeal created
 *       400:
 *         description: Invalid request
 */
router.post('/appeals', controller.create.bind(controller));

/**
 * @openapi
 * /api/v1/appeals/customer/{customerId}:
 *   get:
 *     tags: [appeal-service]
 *     summary: List appeals by customer
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer appeals returned
 */
router.get('/appeals/customer/:customerId', controller.listByCustomer.bind(controller));

// Analyst queue is served by human-verification-service.
router.get('/appeals/pending', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Use GET /api/v1/reviews/appeals/pending via human-verification-service',
  });
});
router.post('/appeals/:appealId/resolve', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Use POST /api/v1/reviews/appeals/:appealId/resolve via human-verification-service',
  });
});

/**
 * @openapi
 * /api/v1/appeals/{appealId}:
 *   get:
 *     tags: [appeal-service]
 *     summary: Get appeal by id
 *     parameters:
 *       - in: path
 *         name: appealId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Appeal returned
 *       404:
 *         description: Appeal not found
 */
router.get('/appeals/:appealId', controller.getById.bind(controller));

// Internal analyst endpoints consumed by human-verification-service.
router.get('/internal/appeals/pending', controller.listPending.bind(controller));
router.post('/internal/appeals/:appealId/resolve', controller.resolve.bind(controller));

module.exports = router;

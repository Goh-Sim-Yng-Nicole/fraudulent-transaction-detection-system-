const express = require('express');
const controller = require('../controllers/reviewController');
const appealReviewController = require('../controllers/appealReviewController');

const router = express.Router();

router.get('/review-cases', controller.listCases.bind(controller));
router.post('/review-cases/:transactionId/claim', controller.claimCase.bind(controller));
router.post('/review-cases/:transactionId/release', controller.releaseCase.bind(controller));
router.post('/review-cases/:transactionId/resolve', controller.submitDecision.bind(controller));

/**
 * @openapi
 * /api/v1/reviews/pending:
 *   get:
 *     tags: [human-verification-service]
 *     summary: List pending review cases
 *     responses:
 *       200:
 *         description: Pending cases returned
 */
router.get('/reviews/pending', controller.listPending.bind(controller));
/**
 * @openapi
 * /api/v1/reviews/{transactionId}:
 *   get:
 *     tags: [human-verification-service]
 *     summary: Get review record by transaction id
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review record returned
 *       404:
 *         description: Review record not found
 */
router.get('/reviews/:transactionId', controller.getByTransaction.bind(controller));
/**
 * @openapi
 * /api/v1/reviews/{transactionId}/decision:
 *   post:
 *     tags: [human-verification-service]
 *     summary: Submit manual review decision
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [APPROVED, DECLINED]
 *               reviewedBy:
 *                 type: string
 *               notes:
 *                 type: string
 *           example:
 *             decision: APPROVED
 *             reviewedBy: reviewer-1
 *             notes: customer confirmed transaction
 *       200:
 *         description: Decision submitted
 *       400:
 *         description: Invalid decision payload
 */
router.post('/reviews/:transactionId/decision', controller.submitDecision.bind(controller));

/**
 * @openapi
 * /api/v1/reviews/appeals/pending:
 *   get:
 *     tags: [human-verification-service]
 *     summary: List pending customer appeals for analyst review
 *     responses:
 *       200:
 *         description: Pending appeals returned
 */
router.get('/reviews/appeals/pending', appealReviewController.listPending.bind(appealReviewController));

/**
 * @openapi
 * /api/v1/reviews/appeals/{appealId}/resolve:
 *   post:
 *     tags: [human-verification-service]
 *     summary: Submit analyst resolution for an appeal
 *     parameters:
 *       - in: path
 *         name: appealId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resolution, reviewedBy]
 *             properties:
 *               resolution:
 *                 type: string
 *                 enum: [UPHOLD, REVERSE]
 *               reviewedBy:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Appeal resolution accepted
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Appeal not found
 */
router.post('/reviews/appeals/:appealId/resolve', appealReviewController.resolve.bind(appealReviewController));

module.exports = router;

const router = require('express').Router();
const auditController = require('../controllers/auditController');
/**
 * @openapi
 * /api/v1/audit/transaction/{transactionId}:
 *   get:
 *     tags: [audit-service]
 *     summary: Get audit trail for a transaction
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction audit trail returned
 */
// Handles GET /audit/transaction/:transactionId.
router.get('/audit/transaction/:transactionId', auditController.getTransactionAudit);
/**
 * @openapi
 * /api/v1/audit/customer/{customerId}:
 *   get:
 *     tags: [audit-service]
 *     summary: Get audit trail for a customer
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer audit trail returned
 */
// Handles GET /audit/customer/:customerId.
router.get('/audit/customer/:customerId', auditController.getCustomerAudit);
/**
 * @openapi
 * /api/v1/audit/verify:
 *   post:
 *     tags: [audit-service]
 *     summary: Verify audit log integrity
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromDate:
 *                 type: string
 *                 format: date-time
 *               toDate:
 *                 type: string
 *                 format: date-time
 *               transactionId:
 *                 type: string
 *           example:
 *             fromDate: "2026-02-23T00:00:00Z"
 *             toDate: "2026-02-24T00:00:00Z"
 *     responses:
 *       200:
 *         description: Integrity verification result returned
 */
// Handles POST /audit/verify.
router.post('/audit/verify', auditController.verifyIntegrity);
/**
 * @openapi
 * /api/v1/audit/stats:
 *   get:
 *     tags: [audit-service]
 *     summary: Get audit service statistics
 *     responses:
 *       200:
 *         description: Audit stats returned
 */
// Handles GET /audit/stats.
router.get('/audit/stats', auditController.getStats);

module.exports = router;

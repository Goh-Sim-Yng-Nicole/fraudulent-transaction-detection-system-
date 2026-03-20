const router = require('express').Router();
const controller = require('../controllers/transactionController');
const { validateCreateTransaction } = require('../middleware/validate');

router.post('/transactions', validateCreateTransaction, controller.create.bind(controller));
router.get('/transactions', controller.list.bind(controller));
router.get('/transactions/customer/:customerId', controller.list.bind(controller));
router.get('/transactions/:transactionId/decision', controller.getDecision.bind(controller));
router.get('/transactions/:transactionId', controller.getById.bind(controller));

module.exports = router;

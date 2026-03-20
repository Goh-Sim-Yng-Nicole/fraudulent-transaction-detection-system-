const transactionService = require('../services/transactionService');

class TransactionController {
  async create(req, res) {
    const record = await transactionService.createTransaction(req.body, {
      requestId: req.requestId,
      correlationId: req.correlationId,
      idempotencyKey: req.idempotencyKey
    });

    return res.status(201).json(record);
  }

  async list(req, res) {
    const customerId = req.query.customer_id || req.query.customerId || req.params.customerId;
    const direction = req.query.direction || 'all';
    const records = await transactionService.listByCustomer(customerId, direction);
    return res.json(records);
  }

  async getById(req, res) {
    const record = await transactionService.getById(req.params.transactionId);
    return res.json(record);
  }

  async getDecision(req, res) {
    const decision = await transactionService.getDecision(req.params.transactionId);
    return res.json(decision);
  }
}

module.exports = new TransactionController();

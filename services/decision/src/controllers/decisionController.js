const decisionRepository = require('../repositories/decisionRepository');
const decisionEngineService = require('../services/decisionEngineService');
const logger = require('../config/logger');

class DecisionController {
  
  // Handles get decision by transaction.
  async getDecisionByTransaction(req, res) {
    const { transactionId } = req.params;

    logger.info('Fetching decision', { transactionId });

    const decision = await decisionRepository.findByTransactionId(transactionId);

    if (!decision) {
      return res.status(404).json({
        success: false,
        error: 'Decision not found',
        transactionId,
      });
    }

    res.status(200).json({
      success: true,
      data: decision,
    });
  }

  
  // Handles get stats.
  async getStats(req, res) {
    const since = req.query.since
      ? new Date(req.query.since)
      : new Date(Date.now() - 3600000);

    logger.info('Fetching decision stats', { since });

    const stats = await decisionRepository.getStats(since);

    res.status(200).json({
      success: true,
      data: {
        since,
        now: new Date(),
        stats,
      },
    });
  }

  
  // Handles get thresholds.
  getThresholds(req, res) {
    const thresholds = decisionEngineService.getThresholds();

    res.status(200).json({
      success: true,
      data: thresholds,
    });
  }
}

module.exports = new DecisionController();
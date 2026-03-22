const auditRepository = require('../repositories/auditRepository');
const logger = require('../config/logger');

class AuditController {

  // Handles get transaction audit.
  async getTransactionAudit(req, res) {
    const { transactionId } = req.params;
    const includePayload = req.query.includePayload !== 'false';
    const queriedBy = req.headers['x-user-id'] || 'anonymous';

    const startTime = Date.now();

    logger.info('Transaction audit query', { transactionId, queriedBy });

    const trail = await auditRepository.getAuditTrail(transactionId, { includePayload });

    const executionTime = Date.now() - startTime;
    await auditRepository.logQuery(
      'transaction_audit',
      { transactionId, includePayload },
      trail.length,
      executionTime,
      queriedBy,
      req.query.reason || 'investigation'
    );

    res.status(200).json({
      success: true,
      data: {
        transactionId,
        eventCount: trail.length,
        events: trail,
      },
      metadata: {
        executionTimeMs: executionTime,
        queriedBy,
      },
    });
  }


  // Handles get customer audit.
  async getCustomerAudit(req, res) {
    const { customerId } = req.params;
    const { since, until, eventTypes, limit } = req.query;
    const queriedBy = req.headers['x-user-id'] || 'anonymous';

    const startTime = Date.now();

    logger.info('Customer audit query', { customerId, queriedBy });

    const trail = await auditRepository.getCustomerAuditTrail(customerId, {
      since: since ? new Date(since) : null,
      until: until ? new Date(until) : null,
      eventTypes: eventTypes ? eventTypes.split(',') : null,
      limit: limit ? parseInt(limit) : 100,
    });

    const executionTime = Date.now() - startTime;

    await auditRepository.logQuery(
      'customer_audit',
      { customerId, since, until, eventTypes, limit },
      trail.length,
      executionTime,
      queriedBy,
      req.query.reason || 'investigation'
    );

    res.status(200).json({
      success: true,
      data: {
        customerId,
        eventCount: trail.length,
        events: trail,
      },
      metadata: {
        executionTimeMs: executionTime,
        queriedBy,
      },
    });
  }


  // Handles verify integrity.
  async verifyIntegrity(req, res) {
    const { startEventId, endEventId } = req.body;

    logger.info('Chain integrity verification', { startEventId, endEventId });

    const result = await auditRepository.verifyChainIntegrity(startEventId, endEventId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }


  // Handles get stats.
  async getStats(req, res) {
    const since = req.query.since
      ? new Date(req.query.since)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stats = await auditRepository.getStats(since);

    res.status(200).json({
      success: true,
      data: {
        ...stats,
        since,
      },
    });
  }
}

module.exports = new AuditController();
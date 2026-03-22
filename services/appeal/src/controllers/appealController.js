const appealService = require('../services/appealService');

class AppealController {
  // Handles create appeal.
  async create(req, res) {
    const { transactionId, customerId, appealReason, evidence } = req.body;

    if (!transactionId || !customerId || !appealReason) {
      return res.status(400).json({
        success: false,
        error: 'transactionId, customerId, and appealReason are required',
      });
    }

    try {
      const data = await appealService.createAppeal({
        transactionId,
        customerId,
        appealReason,
        evidence,
        correlationId: req.headers['x-correlation-id'] || null,
        authHeader: req.headers.authorization || null,
      });

      res.status(201).json({ success: true, data });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (
        err.message.includes('required') ||
        err.message.includes('allowed only') ||
        err.message.includes('already exists') ||
        err.message.includes('already been appealed') ||
        err.message.includes('does not belong') ||
        err.message.includes('duplicate key')
      ) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  }

  // Handles get appeal by id.
  async getById(req, res) {
    const data = await appealService.getByAppealId(req.params.appealId);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: `Appeal ${req.params.appealId} not found`,
      });
    }
    res.json({ success: true, data });
  }

  // Handles list pending appeals.
  async listPending(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const data = await appealService.listPending(limit, offset);
    res.json({ success: true, data, meta: { limit, offset, count: data.length } });
  }

  async claim(req, res) {
    const reviewerId = req.staff?.userId || req.body?.reviewerId;
    const reviewerRole = req.staff?.role || req.body?.reviewerRole || null;
    const claimTtlMinutes = Math.min(Math.max(parseInt(req.body?.claimTtlMinutes, 10) || 10, 1), 120);

    if (!reviewerId || typeof reviewerId !== 'string') {
      return res.status(400).json({ success: false, error: 'reviewerId is required' });
    }

    const data = await appealService.claimAppeal({
      appealId: req.params.appealId,
      reviewerId,
      reviewerRole,
      claimTtlMinutes,
    });

    if (!data) {
      return res.status(404).json({ success: false, error: `Appeal ${req.params.appealId} not found` });
    }

    if (data.conflict) {
      return res.status(409).json({ success: false, error: data.conflict, details: data });
    }

    return res.json({ success: true, data });
  }

  async release(req, res) {
    const reviewerId = req.staff?.userId || req.body?.reviewerId;
    const reviewerRole = req.staff?.role || req.body?.reviewerRole || null;
    const notes = req.body?.notes || null;

    if (!reviewerId || typeof reviewerId !== 'string') {
      return res.status(400).json({ success: false, error: 'reviewerId is required' });
    }

    const data = await appealService.releaseAppeal({
      appealId: req.params.appealId,
      reviewerId,
      reviewerRole,
      notes,
    });

    if (!data) {
      return res.status(404).json({ success: false, error: `Appeal ${req.params.appealId} not found` });
    }

    if (data.conflict) {
      return res.status(409).json({ success: false, error: data.conflict, details: data });
    }

    return res.json({ success: true, data });
  }

  // Handles list customer appeals.
  async listByCustomer(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const data = await appealService.listByCustomer(req.params.customerId, limit, offset);
    res.json({ success: true, data, meta: { limit, offset, count: data.length } });
  }

  // Handles resolve appeal.
  async resolve(req, res) {
    const { resolution, notes } = req.body;
    const reviewedBy = req.staff?.userId || req.body?.reviewedBy;
    const reviewedRole = req.staff?.role || req.body?.reviewedRole || null;
    if (!resolution || !reviewedBy) {
      return res.status(400).json({
        success: false,
        error: 'resolution and reviewedBy are required',
      });
    }

    try {
      const data = await appealService.resolveAppeal({
        appealId: req.params.appealId,
        resolution,
        reviewedBy,
        reviewedRole,
        resolutionNotes: notes,
      });

      res.json({ success: true, data });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (
        err.message.includes('already resolved')
        || err.message.includes('must be')
        || err.message.includes('Unable to claim appeal')
      ) {
        return res.status(400).json({ success: false, error: err.message });
      }
      throw err;
    }
  }
}

module.exports = new AppealController();

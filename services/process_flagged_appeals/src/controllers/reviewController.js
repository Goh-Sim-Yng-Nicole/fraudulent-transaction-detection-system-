const reviewService = require('../services/reviewService');

class ReviewController {
  async listCases(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const data = await reviewService.listCases({
      status: req.query.status,
      assignee: req.query.assignee,
      limit,
      offset,
    });

    res.json({ success: true, data, meta: { limit, offset, count: data.length } });
  }

  // Handles list pending.
  async listPending(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const data = await reviewService.listPending(limit, offset);
    res.json({ success: true, data, meta: { limit, offset, count: data.length } });
  }

  // Handles get by transaction.
  async getByTransaction(req, res) {
    const data = await reviewService.getReviewByTransaction(req.params.transactionId);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: `Manual review for transaction ${req.params.transactionId} not found`,
      });
    }
    res.json({ success: true, data });
  }

  async getHistory(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const data = await reviewService.getCaseHistory(req.params.transactionId, limit);
    res.json({ success: true, data, meta: { limit, count: data.length } });
  }

  async claimCase(req, res) {
    const reviewerId = req.staff?.userId || req.body?.reviewerId;
    const reviewerRole = req.staff?.role || req.body?.reviewerRole || null;
    const claimTtlMinutes = req.body?.claimTtlMinutes;
    if (!reviewerId || typeof reviewerId !== 'string') {
      return res.status(400).json({ success: false, error: 'reviewerId is required' });
    }

    const data = await reviewService.claimCase({
      transactionId: req.params.transactionId,
      reviewerId,
      reviewerRole,
      claimTtlMinutes: Math.min(Math.max(parseInt(claimTtlMinutes, 10) || 10, 1), 120),
    });

    if (!data) {
      return res.status(404).json({ success: false, error: 'Review case not found' });
    }

    if (data.conflict) {
      return res.status(409).json({ success: false, error: data.conflict, details: data });
    }

    return res.json({ success: true, data });
  }

  async releaseCase(req, res) {
    const reviewerId = req.staff?.userId || req.body?.reviewerId;
    const reviewerRole = req.staff?.role || req.body?.reviewerRole || null;
    const notes = req.body?.notes;
    if (!reviewerId || typeof reviewerId !== 'string') {
      return res.status(400).json({ success: false, error: 'reviewerId is required' });
    }

    const data = await reviewService.releaseCase({
      transactionId: req.params.transactionId,
      reviewerId,
      reviewerRole,
      notes,
    });

    if (!data) {
      return res.status(404).json({ success: false, error: 'Review case not found' });
    }

    if (data.conflict) {
      return res.status(409).json({ success: false, error: data.conflict, details: data });
    }

    return res.json({ success: true, data });
  }

  // Handles submit decision.
  async submitDecision(req, res) {
    const { decision, notes } = req.body;
    const reviewedBy = req.staff?.userId || req.body?.reviewedBy;
    const reviewedRole = req.staff?.role || req.body?.reviewedRole || null;
    const allowed = new Set(['APPROVED', 'DECLINED']);
    if (!allowed.has(decision)) {
      return res.status(400).json({
        success: false,
        error: 'decision must be APPROVED or DECLINED',
      });
    }
    if (!reviewedBy || typeof reviewedBy !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'reviewedBy is required',
      });
    }

    try {
      const data = await reviewService.applyDecision({
        transactionId: req.params.transactionId,
        decision,
        reviewedBy,
        reviewedRole,
        notes,
      });

      if (data?.conflict) {
        return res.status(409).json({ success: false, error: data.conflict, details: data });
      }

      res.json({ success: true, data });
    } catch (err) {
      if (err.message.startsWith('No manual review record')) {
        return res.status(404).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
  }
}

module.exports = new ReviewController();

const appealReviewService = require('../services/appealReviewService');

class AppealReviewController {
  // Handles list pending appeals.
  async listPending(req, res) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const data = await appealReviewService.listPendingAppeals({
      limit,
      offset,
      authHeader: req.headers.authorization || null,
      correlationId: req.headers['x-correlation-id'] || null,
    });

    res.json({
      success: true,
      data,
      meta: { limit, offset, count: data.length },
    });
  }

  async claim(req, res) {
    const reviewerId = req.staff?.userId || req.body?.reviewerId;
    const reviewerRole = req.staff?.role || req.body?.reviewerRole || null;
    const claimTtlMinutes = Math.min(Math.max(parseInt(req.body?.claimTtlMinutes, 10) || 10, 1), 120);

    if (!reviewerId) {
      return res.status(400).json({
        success: false,
        error: 'reviewerId is required',
      });
    }

    try {
      const data = await appealReviewService.claimAppeal({
        appealId: req.params.appealId,
        reviewerId,
        reviewerRole,
        claimTtlMinutes,
        authHeader: req.headers.authorization || null,
        correlationId: req.headers['x-correlation-id'] || null,
      });

      res.json({ success: true, data });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      if ([400, 404, 409].includes(statusCode)) {
        return res.status(statusCode).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
  }

  async release(req, res) {
    const reviewerId = req.staff?.userId || req.body?.reviewerId;
    const reviewerRole = req.staff?.role || req.body?.reviewerRole || null;
    const notes = req.body?.notes || null;

    if (!reviewerId) {
      return res.status(400).json({
        success: false,
        error: 'reviewerId is required',
      });
    }

    try {
      const data = await appealReviewService.releaseAppeal({
        appealId: req.params.appealId,
        reviewerId,
        reviewerRole,
        notes,
        authHeader: req.headers.authorization || null,
        correlationId: req.headers['x-correlation-id'] || null,
      });

      res.json({ success: true, data });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      if ([400, 404, 409].includes(statusCode)) {
        return res.status(statusCode).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
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

    const allowed = new Set(['UPHOLD', 'REVERSE']);
    if (!allowed.has(String(resolution).toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: 'resolution must be UPHOLD or REVERSE',
      });
    }

    try {
      const data = await appealReviewService.resolveAppeal({
        appealId: req.params.appealId,
        resolution: String(resolution).toUpperCase(),
        reviewedBy,
        reviewedRole,
        notes,
        authHeader: req.headers.authorization || null,
        correlationId: req.headers['x-correlation-id'] || null,
      });

      res.json({ success: true, data });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      if ([400, 404].includes(statusCode)) {
        return res.status(statusCode).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
  }
}

module.exports = new AppealReviewController();

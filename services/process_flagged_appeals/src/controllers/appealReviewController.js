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

  // Handles resolve appeal.
  async resolve(req, res) {
    const { resolution, reviewedBy, notes } = req.body;
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

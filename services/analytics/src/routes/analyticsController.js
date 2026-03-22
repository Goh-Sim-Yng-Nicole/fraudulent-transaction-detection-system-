const analyticsService = require('../services/analyticsService');
const logger = require('../config/logger');

class AnalyticsController {
  // Handles get dashboard.
  async getDashboard(req, res) {
    const timeRange = req.query.timeRange || '24h';
    
    logger.info('Dashboard request', { timeRange });

    const metrics = await analyticsService.getDashboardMetrics(timeRange);

    res.status(200).json({
      success: true,
      data: metrics,
    });
  }

  // Handles get real time.
  async getRealTime(req, res) {
    const stats = await analyticsService.getRealTimeStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  }
}

module.exports = new AnalyticsController();
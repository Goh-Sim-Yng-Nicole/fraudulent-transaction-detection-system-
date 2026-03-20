const logger = require('../config/logger');
const MetricsService = require('../utils/metrics');

// Handles request logger.
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  logger.info('Incoming request', {
    requestId: req.requestId,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.userId,
  });
  MetricsService.incrementActiveConnections();
  const originalSend = res.send;
  res.send = function (data) {
    res.send = originalSend;
    res.send(data);

    const duration = (Date.now() - startTime) / 1000;
    logger.info('Request completed', {
      requestId: req.requestId,
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}s`,
      userId: req.user?.userId,
    });
    MetricsService.recordHttpRequest(
      req.method,
      req.route?.path || req.path,
      res.statusCode.toString(),
      duration
    );
    MetricsService.decrementActiveConnections();
  };

  next();
};

module.exports = requestLogger;
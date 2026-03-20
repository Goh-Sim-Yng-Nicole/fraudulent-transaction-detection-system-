const logger = require('../config/logger');

const errorHandler = (err, req, res, _next) => {
  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    error: err?.message || String(err),
    stack: err?.stack,
  });

  res.status(err?.statusCode || err?.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : (err?.message || 'Internal server error'),
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `${req.method} ${req.path} not found`,
  });
};

module.exports = { errorHandler, notFoundHandler };

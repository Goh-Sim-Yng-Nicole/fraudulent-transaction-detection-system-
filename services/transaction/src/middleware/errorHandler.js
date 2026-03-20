const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, _next) => {
  logger.error('Request failed', {
    requestId: req.requestId,
    path: req.path,
    method: req.method,
    code: err.code,
    message: err.message,
    stack: err instanceof AppError ? undefined : err.stack
  });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      detail: err.message,
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: err.timestamp
    });
  }

  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    detail: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    requestId: req.requestId,
    correlationId: req.correlationId
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    detail: `${req.method} ${req.path} not found`,
    requestId: req.requestId
  });
};

module.exports = {
  errorHandler,
  notFoundHandler
};

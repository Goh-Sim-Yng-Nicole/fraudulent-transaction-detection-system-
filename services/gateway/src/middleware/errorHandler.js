const logger = require('../config/logger');
const { AppError } = require('../utils/errors');
const { HTTP_STATUS } = require('../utils/constants');

// Handles error handler.
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;
  logger.error('Error occurred:', {
    requestId: req.requestId,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    error: error.message,
    stack: error.stack,
    userId: req.user?.userId,
  });
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        statusCode: err.statusCode,
        timestamp: err.timestamp || new Date().toISOString(),
        requestId: req.requestId,
        correlationId: req.correlationId,
      },
    });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        message: 'Invalid token',
        statusCode: HTTP_STATUS.UNAUTHORIZED,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        message: 'Token expired',
        statusCode: HTTP_STATUS.UNAUTHORIZED,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }
  if (err.name === 'ValidationError') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        message: 'Validation error',
        details: err.message,
        statusCode: HTTP_STATUS.BAD_REQUEST,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message,
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
};

// Handles not found handler.
const notFoundHandler = (req, res, next) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      statusCode: HTTP_STATUS.NOT_FOUND,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
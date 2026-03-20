const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { BadRequestError } = require('../utils/errors');
const { REQUEST_ID_HEADER, CORRELATION_ID_HEADER, IDEMPOTENCY_KEY_HEADER } = require('../utils/constants');

// Handles validate request.
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return next(new BadRequestError(JSON.stringify(errors)));
    }

    req.body = value;
    next();
  };
};

// Handles validate query params.
const validateQueryParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return next(new BadRequestError(JSON.stringify(errors)));
    }

    req.query = value;
    next();
  };
};

// Handles attach request metadata.
const attachRequestMetadata = (req, res, next) => {
  req.requestId = req.headers[REQUEST_ID_HEADER.toLowerCase()] || uuidv4();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  req.correlationId = req.headers[CORRELATION_ID_HEADER.toLowerCase()] || req.requestId;
  res.setHeader(CORRELATION_ID_HEADER, req.correlationId);
  req.idempotencyKey = req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
  if (req.idempotencyKey) {
    res.setHeader(IDEMPOTENCY_KEY_HEADER, req.idempotencyKey);
  }
  req.timestamp = new Date().toISOString();

  next();
};

module.exports = {
  validateRequest,
  validateQueryParams,
  attachRequestMetadata,
};
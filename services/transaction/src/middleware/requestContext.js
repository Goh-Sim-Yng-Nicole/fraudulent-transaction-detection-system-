const { v4: uuidv4 } = require('uuid');
const { HEADERS } = require('../utils/constants');

module.exports = (req, res, next) => {
  req.requestId = req.headers[HEADERS.REQUEST_ID] || uuidv4();
  req.correlationId = req.headers[HEADERS.CORRELATION_ID] || req.requestId;
  req.idempotencyKey = req.headers[HEADERS.IDEMPOTENCY_KEY] || null;
  req.ipAddress = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || req.ip
    || null;
  req.userAgent = req.headers['user-agent'] || null;

  res.setHeader(HEADERS.REQUEST_ID, req.requestId);
  res.setHeader(HEADERS.CORRELATION_ID, req.correlationId);
  next();
};

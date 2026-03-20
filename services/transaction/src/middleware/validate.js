const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

const createSchema = Joi.object({
  customerId: Joi.string().trim().required(),
  amount: Joi.number().positive().max(1000000).required(),
  currency: Joi.string().trim().length(3).default('SGD'),
  cardType: Joi.string().trim().max(32).default('CREDIT'),
  country: Joi.string().trim().min(2).max(8).required(),
  merchantId: Joi.string().trim().allow(null, '').optional(),
  senderName: Joi.string().trim().allow(null, '').optional(),
  recipientCustomerId: Joi.string().trim().allow(null, '').optional(),
  recipientName: Joi.string().trim().allow(null, '').optional(),
  hourUtc: Joi.number().integer().min(0).max(23).optional()
}).required();

const normalizeCreatePayload = (payload = {}) => ({
  customerId: payload.customerId || payload.customer_id,
  amount: payload.amount,
  currency: payload.currency,
  cardType: payload.cardType || payload.card_type,
  country: payload.country,
  merchantId: payload.merchantId ?? payload.merchant_id ?? null,
  senderName: payload.senderName ?? payload.sender_name ?? null,
  recipientCustomerId: payload.recipientCustomerId ?? payload.recipient_customer_id ?? null,
  recipientName: payload.recipientName ?? payload.recipient_name ?? null,
  hourUtc: payload.hourUtc ?? payload.hour_utc
});

const validateCreateTransaction = (req, _res, next) => {
  const normalized = normalizeCreatePayload(req.body);
  const { error, value } = createSchema.validate(normalized, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });

  if (error) {
    return next(new ValidationError(error.details.map((detail) => detail.message).join('; ')));
  }

  req.body = value;
  return next();
};

module.exports = {
  validateCreateTransaction
};

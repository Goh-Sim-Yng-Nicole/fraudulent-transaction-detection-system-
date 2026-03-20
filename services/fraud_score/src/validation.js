import Joi from "joi";

const flatScoreRequestSchema = Joi.object({
  amount: Joi.number().required(),
  currency: Joi.string().min(1).max(10).required(),
  card_type: Joi.string().min(1).max(32).required(),
  country: Joi.string().min(1).max(8).required(),
  hour_utc: Joi.number().integer().min(0).max(23).required(),
  merchant_id: Joi.string().max(64).optional(),
  velocity_txn_hour_raw: Joi.number().integer().min(0).max(1000).optional(),
  geo_country_high_risk: Joi.boolean().optional()
}).unknown(true);

const modernScoreRequestSchema = Joi.object({
  transaction: Joi.object({
    amount: Joi.number().required(),
    currency: Joi.string().min(1).max(10).required(),
    cardType: Joi.string().min(1).max(32).optional(),
    card_type: Joi.string().min(1).max(32).optional(),
    createdAt: Joi.string().optional(),
    merchantId: Joi.string().max(64).optional(),
    merchant_id: Joi.string().max(64).optional(),
    location: Joi.object({
      country: Joi.string().min(1).max(8).optional()
    }).optional()
  }).required(),
  ruleResults: Joi.object({
    riskFactors: Joi.object({
      velocity: Joi.object({
        countLastHour: Joi.number().integer().min(0).optional()
      }).optional(),
      geography: Joi.object({
        highRiskCountry: Joi.boolean().optional()
      }).optional()
    }).optional()
  }).optional()
}).unknown(true);

export const scoreRequestSchema = Joi.alternatives().try(
  flatScoreRequestSchema,
  modernScoreRequestSchema
);

export const modelQuerySchema = Joi.object({
  model_version: Joi.string().valid("v1", "v2").optional(),
}).unknown(true);


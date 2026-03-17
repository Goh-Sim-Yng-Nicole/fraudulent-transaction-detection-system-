import Joi from "joi";

export const scoreRequestSchema = Joi.object({
  amount: Joi.number().required(),
  currency: Joi.string().min(1).max(10).required(),
  card_type: Joi.string().min(1).max(32).required(),
  country: Joi.string().min(1).max(8).required(),
  hour_utc: Joi.number().integer().min(0).max(23).required(),
  merchant_id: Joi.string().max(64).optional(),

  velocity_txn_hour_raw: Joi.number().integer().min(0).max(1000).optional(),
  geo_country_high_risk: Joi.boolean().optional(),
}).unknown(true);

export const modelQuerySchema = Joi.object({
  model_version: Joi.string().valid("v1", "v2").optional(),
}).unknown(true);


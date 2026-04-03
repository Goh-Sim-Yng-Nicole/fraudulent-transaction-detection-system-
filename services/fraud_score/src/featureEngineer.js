import { config } from "./config.js";

export class FeatureEngineer {
  constructor() {
    this.featureVersion = "2.1.0";
  }

  extract(transaction, ruleResults = {}) {
    const features = {};
    const amount = Number(transaction.amount ?? 0) || 0;
    const currency = String(transaction.currency ?? "").toUpperCase();
    const cardType = String(transaction.cardType ?? transaction.card_type ?? "").toLowerCase();
    const timestamp = transaction.createdAt ? new Date(transaction.createdAt) : new Date();
    const hourOfDay = Number.isNaN(timestamp.getTime()) ? new Date().getUTCHours() : timestamp.getUTCHours();
    const dayOfWeek = Number.isNaN(timestamp.getTime()) ? new Date().getUTCDay() : timestamp.getUTCDay();
    const country =
      String(transaction.location?.country ?? transaction.country ?? "UNKNOWN").toUpperCase() || "UNKNOWN";

    features.amount = amount;
    features.amount_log = Math.log10(Math.max(amount, 0.01));
    features.amount_bin = this._binAmount(amount);
    features.amount_is_round = amount >= 100 && Math.abs(amount % 100) < 1e-9 ? 1 : 0;

    features.currency_usd = currency === "USD" ? 1 : 0;
    features.currency_eur = currency === "EUR" ? 1 : 0;
    features.currency_gbp = currency === "GBP" ? 1 : 0;

    features.hour_of_day = hourOfDay;
    features.day_of_week = dayOfWeek;
    features.is_weekend = dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0;
    features.is_night = hourOfDay >= 0 && hourOfDay < 6 ? 1 : 0;
    features.hour_bin = this._binHour(hourOfDay);

    features.card_type_visa = cardType === "visa" ? 1 : 0;
    features.card_type_mastercard = cardType === "mastercard" ? 1 : 0;
    features.card_type_amex = cardType === "amex" ? 1 : 0;

    features.country_risk = this._getCountryRiskScore(country);
    features.country_sg = country === "SG" ? 1 : 0;
    features.country_us = country === "US" ? 1 : 0;
    features.country_gb = country === "GB" ? 1 : 0;

    features.rules_flagged = ruleResults.flagged ? 1 : 0;
    const rawRuleScore = Number(ruleResults.ruleScore ?? 0) || 0;
    const rawRuleReasonCount = Array.isArray(ruleResults.reasons) ? ruleResults.reasons.length : 0;
    features.rules_score = Math.min(rawRuleScore / 100, 1);
    features.rules_reason_count = Math.min(rawRuleReasonCount / 10, 1);

    const velocityFactors = ruleResults.riskFactors?.velocity ?? {};
    const rawVelocityTxnHour = Number(
      velocityFactors.customerTransactionsLastHour ?? velocityFactors.countLastHour ?? 0,
    ) || 0;
    const rawVelocityAmountHour = Number(
      velocityFactors.customerAmountLastHour ?? velocityFactors.amountLastHour ?? 0,
    ) || 0;
    const rawVelocityTxnDay = Number(velocityFactors.customerTransactionsLastDay ?? 0) || 0;
    features.velocity_txn_hour = Math.min(rawVelocityTxnHour / 10, 1);
    features.velocity_amount_hour = Math.min(rawVelocityAmountHour / 10000, 1);
    features.velocity_txn_day = Math.min(rawVelocityTxnDay / 50, 1);
    features.velocity_txn_hour_norm = this._normalizeVelocity(rawVelocityTxnHour, 10);
    features.velocity_amount_hour_norm = this._normalizeVelocity(rawVelocityAmountHour, 10000);
    features.velocity_txn_day_norm = this._normalizeVelocity(rawVelocityTxnDay, 50);

    const geoFactors = ruleResults.riskFactors?.geography ?? {};
    const geoCountry = String(geoFactors.country ?? country ?? "").toUpperCase();
    features.geo_high_risk = geoFactors.highRiskCountry
      ? 1
      : config.features.highRiskCountries.includes(geoCountry)
        ? 1
        : 0;

    const amountFactors = ruleResults.riskFactors?.amount ?? {};
    features.amount_suspicious = amountFactors.suspicious ? 1 : 0;
    features.amount_high = amountFactors.highAmount ? 1 : 0;

    const timeFactors = ruleResults.riskFactors?.time ?? {};
    features.time_unusual = timeFactors.unusualTime ? 1 : 0;

    features.amount_x_velocity = features.amount_log * features.velocity_txn_hour_norm;
    features.night_x_high_amount = features.is_night * features.amount_high;
    features.rules_x_velocity = features.rules_flagged * features.velocity_txn_hour_norm;

    const featureNames = Object.keys(features).sort();
    const featureVector = featureNames.map((name) => features[name]);

    return {
      features,
      featureVector,
      featureNames,
      featureVersion: this.featureVersion,
      featureCount: featureNames.length,
    };
  }

  validate(featureData) {
    const { features, featureCount } = featureData;
    if (featureCount < config.model.minFeaturesRequired) {
      throw new Error(`Insufficient features: ${featureCount} < ${config.model.minFeaturesRequired}`);
    }

    for (const [key, value] of Object.entries(features)) {
      if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) {
        throw new Error(`Invalid feature value: ${key} = ${value}`);
      }
    }

    return true;
  }

  _binAmount(amount) {
    const bins = config.features.amountBins;
    for (let i = 0; i < bins.length; i++) {
      if (amount < bins[i]) return i;
    }
    return bins.length;
  }

  _binHour(hour) {
    const bins = config.features.hourBins;
    for (let i = 0; i < bins.length - 1; i++) {
      if (hour >= bins[i] && hour < bins[i + 1]) return i;
    }
    return bins.length - 1;
  }

  _getCountryRiskScore(country) {
    const highRiskCountries = ["NG", "RU", "CN", "PK", "VN", "KP", "IR"];
    const mediumRiskCountries = ["BR", "IN", "ID", "PH", "UA"];

    if (highRiskCountries.includes(country)) return 1.0;
    if (mediumRiskCountries.includes(country)) return 0.5;
    return 0.1;
  }

  _normalizeVelocity(value, threshold) {
    return 1 - Math.exp((-config.features.velocityDecay * value) / threshold);
  }
}

export const featureEngineer = new FeatureEngineer();

import { AppError } from "../errors.js";
import { scoreRequestSchema, modelQuerySchema } from "../validation.js";
import { featureEngineer } from "../featureEngineer.js";

function normalizeTransaction(body) {
  if (body?.transaction) {
    const transaction = body.transaction ?? {};
    return {
      id: transaction.id ?? transaction.transactionId ?? "adhoc-score",
      customerId: transaction.customerId ?? transaction.customer_id ?? "adhoc-customer",
      merchantId: transaction.merchantId ?? transaction.merchant_id ?? body.merchant_id ?? "unknown",
      amount: transaction.amount,
      currency: transaction.currency,
      cardType: transaction.cardType ?? transaction.card_type ?? body.card_type ?? "credit",
      location: transaction.location ?? { country: transaction.country ?? body.country ?? "SG" },
      createdAt: transaction.createdAt ?? new Date().toISOString(),
    };
  }

  const createdAt = body?.createdAt
    ? new Date(body.createdAt).toISOString()
    : new Date(Date.UTC(2025, 0, 1, Number(body?.hour_utc ?? 0), 0, 0)).toISOString();

  return {
    id: body?.transactionId ?? "adhoc-score",
    customerId: body?.customerId ?? "adhoc-customer",
    merchantId: body?.merchant_id ?? body?.merchantId ?? "unknown",
    amount: body?.amount,
    currency: body?.currency,
    cardType: body?.card_type ?? body?.cardType ?? "credit",
    location: { country: body?.country ?? "SG" },
    createdAt,
  };
}

function normalizeRuleResults(body) {
  if (body?.ruleResults) {
    return {
      flagged: Boolean(body.ruleResults.flagged),
      ruleScore: Number(body.ruleResults.ruleScore ?? 0) || 0,
      reasons: Array.isArray(body.ruleResults.reasons) ? body.ruleResults.reasons : [],
      riskFactors: body.ruleResults.riskFactors ?? {},
    };
  }

  const hourUtc = Number(body?.hour_utc ?? 0) || 0;
  const amount = Number(body?.amount ?? 0) || 0;
  return {
    flagged: false,
    ruleScore: 0,
    reasons: [],
    riskFactors: {
      velocity: {
        customerTransactionsLastHour: Number(body?.velocity_txn_hour_raw ?? 0) || 0,
        customerAmountLastHour: Number(body?.velocity_amount_hour_raw ?? 0) || 0,
        customerTransactionsLastDay: Number(body?.velocity_txn_day_raw ?? 0) || 0,
      },
      geography: {
        country: body?.country ?? "SG",
        highRiskCountry: Boolean(body?.geo_country_high_risk),
      },
      amount: {
        suspicious: Boolean(body?.amount_suspicious_raw),
        highAmount: Boolean(body?.amount_high_raw) || amount >= 5000,
      },
      time: {
        transactionHourUTC: hourUtc,
        unusualTime: Boolean(body?.unusual_time_raw) || (hourUtc >= 2 && hourUtc < 5),
      },
    },
  };
}

export function createScoreController({
  models,
  defaultModelVersion,
  supportedVersions,
  scoreRequests,
  scoreLatency,
  fallbackProbability,
}) {
  return function score(req, res) {
    const timer = scoreLatency.startTimer();

    const { error: qErr, value: q } = modelQuerySchema.validate(req.query);
    if (qErr) {
      timer({ model_version: "unknown", fallback_used: "true" });
      throw new AppError("invalid query", 400, "VALIDATION_ERROR", qErr.message);
    }

    const requestedHeader = String(req.header("x-model-version") ?? "").trim();
    const versionToUse = (requestedHeader || q.model_version || defaultModelVersion).trim();
    if (!supportedVersions.includes(versionToUse)) {
      timer({ model_version: "unknown", fallback_used: "true" });
      throw new AppError("unknown model_version", 400, "UNKNOWN_MODEL_VERSION", {
        supported: supportedVersions,
      });
    }

    const { error: bErr, value: body } = scoreRequestSchema.validate(req.body ?? {});
    if (bErr) {
      timer({ model_version: versionToUse, fallback_used: "true" });
      throw new AppError("invalid request body", 400, "VALIDATION_ERROR", bErr.message);
    }

    const explainRaw = String(req.query.explain ?? "").trim().toLowerCase();
    const explain = explainRaw === "1" || explainRaw === "true" || explainRaw === "yes";
    const transaction = normalizeTransaction(body);
    const ruleResults = normalizeRuleResults(body);
    const featureData = featureEngineer.extract(transaction, ruleResults);
    featureEngineer.validate(featureData);

    let result;
    let fallback_used = false;
    let explanation = null;
    try {
      const model = models.get(versionToUse);
      if (!model) throw new Error("model not ready");
      result = model.predict(featureData.features);
      if (explain) explanation = model.explain(featureData.features, result);
    } catch (_e) {
      fallback_used = true;
      const probability = fallbackProbability(featureData.features);
      result = {
        score: Math.round(probability * 100),
        probability,
        confidence: null,
        matchedFeatures: featureData.featureCount,
      };
    }

    scoreRequests.inc({ model_version: versionToUse, fallback_used: String(fallback_used) });
    timer({ model_version: versionToUse, fallback_used: String(fallback_used) });

    const payload = {
      fraud_probability: result.probability,
      model_version: versionToUse,
      fallback_used,
      rules_score: result.score,
      success: true,
      data: {
        score: result.score,
        probability: result.probability,
        confidence: fallback_used ? null : Number(result.confidence.toFixed(4)),
        modelVersion: versionToUse,
        features: featureData.features,
        featureVersion: featureData.featureVersion,
        metadata: {
          featureCount: featureData.featureCount,
          matchedFeatures: result.matchedFeatures,
        },
      },
    };
    if (explain && explanation) payload.explanation = explanation;
    return res.json(payload);
  };
}


import { AppError } from "../errors.js";
import { scoreRequestSchema, modelQuerySchema } from "../validation.js";

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

    let probability;
    let fallback_used = false;
    let explanation = null;
    try {
      const model = models.get(versionToUse);
      if (!model) throw new Error("model not ready");
      probability = model.predictProbability(body);
      if (explain) explanation = model.explain(body);
    } catch (_e) {
      fallback_used = true;
      probability = fallbackProbability(body);
    }

    const rules_score = Math.round(probability * 100);
    scoreRequests.inc({ model_version: versionToUse, fallback_used: String(fallback_used) });
    timer({ model_version: versionToUse, fallback_used: String(fallback_used) });

    const payload = {
      fraud_probability: probability,
      model_version: versionToUse,
      fallback_used,
      rules_score,
    };
    if (explain && explanation) payload.explanation = explanation;
    return res.json(payload);
  };
}


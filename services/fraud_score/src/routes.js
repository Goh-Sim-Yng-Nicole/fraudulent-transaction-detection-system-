import express from "express";
import client from "prom-client";
import swaggerUi from "swagger-ui-express";

import { AppError } from "./errors.js";
import { modelQuerySchema } from "./validation.js";

export function buildRoutes({
  config,
  swaggerSpec,
  models,
  modelErrors,
  supportedVersions,
  scoreController,
}) {
  const router = express.Router();

  router.get("/favicon.ico", (_req, res) => res.status(204).send());

  router.get("/", (_req, res) => res.redirect("/api-docs"));

  router.get("/docs", (_req, res) => {
    res.json({
      service: "fraud-score",
      endpoints: ["POST /score", "GET /health", "GET /model", "GET /metrics", "GET /api-docs"],
      default_model_version: config.defaultModelVersion,
      supported_model_versions: supportedVersions,
    });
  });

  router.get("/health", (_req, res) => {
    const ready = supportedVersions.some((v) => models.has(v));
    res.json({
      status: "ok",
      model_ready: ready,
      default_model_version: config.defaultModelVersion,
      supported_model_versions: supportedVersions,
      loaded_versions: [...models.keys()],
    });
  });

  router.get("/model", (req, res) => {
    const { error: qErr, value: q } = modelQuerySchema.validate(req.query);
    if (qErr) throw new AppError("invalid query", 400, "VALIDATION_ERROR", qErr.message);

    const requested = String(q.model_version ?? config.defaultModelVersion).trim();
    if (!supportedVersions.includes(requested)) {
      throw new AppError("unknown model_version", 400, "UNKNOWN_MODEL_VERSION", {
        supported: supportedVersions,
      });
    }
    const model = models.get(requested);
    if (!model) {
      const err = modelErrors.get(requested);
      throw new AppError("model not ready", 503, "MODEL_NOT_READY", {
        model_version: requested,
        model_error: String(err?.message ?? ""),
      });
    }
    return res.json({
      model_version: model.version,
      feature_names: model.featureNames,
      metrics: model.metrics,
    });
  });

  router.get("/metrics", async (_req, res) => {
    res.set("Content-Type", client.register.contentType);
    res.send(await client.register.metrics());
  });

  // Canonical endpoint (used by detect-fraud)
  router.post("/score", scoreController);
  // Versioned alias (nice for docs)
  router.post("/api/v1/score", scoreController);

  // Swagger UI
  router.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  router.get("/api-docs.json", (_req, res) => res.json(swaggerSpec));

  return router;
}

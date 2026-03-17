import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import client from "prom-client";

import { config } from "./config.js";
import { createLogger } from "./logger.js";
import { correlationId } from "./middleware/correlationId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { buildSwaggerSpec } from "./swagger.js";
import { createScoreController } from "./controllers/scoreController.js";
import {
  fallbackProbability,
  listSupportedVersions,
  loadOrTrainModel,
} from "./model.js";
import { buildRoutes } from "./routes.js";

const logger = createLogger();
const supportedVersions = listSupportedVersions();

// Prometheus
client.collectDefaultMetrics();
const scoreRequests = new client.Counter({
  name: "fraud_score_requests_total",
  help: "Total score requests",
  labelNames: ["model_version", "fallback_used"],
});
const scoreLatency = new client.Histogram({
  name: "fraud_score_request_duration_seconds",
  help: "Score request latency (seconds)",
  labelNames: ["model_version", "fallback_used"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
});

// Model registry (stateless service, but models are in-memory)
const models = new Map(); // version -> FraudModel
const modelErrors = new Map(); // version -> Error

async function initModels() {
  for (const v of supportedVersions) {
    try {
      const m = await loadOrTrainModel({ version: v });
      models.set(v, m);
      logger.info({ modelVersion: m.version, metrics: m.metrics }, "model loaded");
    } catch (err) {
      modelErrors.set(v, err);
      logger.error(
        { modelVersion: v, err: { message: err?.message, stack: err?.stack } },
        "model init failed, will use fallback",
      );
    }
  }
}

const app = express();
app.set("trust proxy", 1);

// Security/perf
app.use(helmet());
app.use(
  cors({
    origin:
      config.corsOrigins === "*"
        ? true
        : config.corsOrigins.split(",").map((s) => s.trim()),
    credentials: false,
  }),
);
app.use(compression());

// Parsing
app.use(express.json({ limit: config.bodyLimit }));

// Observability
app.use(correlationId);
app.use(requestLogger(logger));

const swaggerSpec = buildSwaggerSpec({
  serviceVersion: config.serviceVersion,
  defaultModelVersion: config.defaultModelVersion,
});

const scoreController = createScoreController({
  models,
  defaultModelVersion: config.defaultModelVersion,
  supportedVersions,
  scoreRequests,
  scoreLatency,
  fallbackProbability,
});

app.use(
  buildRoutes({
    config,
    swaggerSpec,
    models,
    modelErrors,
    supportedVersions,
    scoreController,
  }),
);

app.use(notFoundHandler);
app.use(errorHandler);

await initModels();

const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info({ port: config.port }, "listening");
});

function shutdown(signal) {
  logger.info({ signal }, "shutdown");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));


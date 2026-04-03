export function env(name, fallback = "") {
  const v = process.env[name];
  return (v ?? fallback).toString().trim();
}

export function envInt(name, fallback) {
  const raw = env(name, "");
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: envInt("PORT", 8001),
  serviceVersion: env("SERVICE_VERSION", "1.0.0"),
  defaultModelVersion: env("MODEL_VERSION", "v1") || "v1",
  corsOrigins: env("CORS_ORIGINS", "*"),
  bodyLimit: env("BODY_LIMIT", "1mb"),
  model: {
    artifactDir: env("MODEL_ARTIFACT_DIR", "models"),
    datasetPath: env("MODEL_DATASET_PATH", "data/synthetic_training_full.csv"),
    minFeaturesRequired: envInt("MIN_FEATURES_REQUIRED", 8),
  },
  features: {
    amountBins: env("FEATURE_AMOUNT_BINS", "5,10,50,100,500,1000,5000,10000")
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)),
    hourBins: env("FEATURE_HOUR_BINS", "0,6,12,18,24")
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)),
    velocityDecay: Number(env("FEATURE_VELOCITY_DECAY", "0.5")) || 0.5,
    highRiskCountries: env("HIGH_RISK_COUNTRIES", "NG,RU,CN,PK")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  },
};


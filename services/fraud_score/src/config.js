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
};


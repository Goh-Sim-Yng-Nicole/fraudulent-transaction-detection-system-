import pino from "pino";

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL || "info",
    base: {
      service: "fraud-score",
    },
    redact: {
      paths: ["req.headers.authorization"],
      remove: true,
    },
  });
}


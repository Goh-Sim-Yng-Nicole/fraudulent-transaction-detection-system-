import { AppError } from "../errors.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    code: "NOT_FOUND",
    error: `${req.method} ${req.path} not found`,
    correlationId: req.correlationId,
  });
}

export function errorHandler(err, req, res, _next) {
  const logger = req.log || console;
  logger.error(
    {
      correlationId: req.correlationId,
      err: {
        message: err?.message,
        stack: err?.stack,
        code: err?.code,
      },
    },
    "Unhandled request error",
  );

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      error: err.details ?? err.message,
      correlationId: req.correlationId,
    });
  }

  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error: "Internal server error",
    correlationId: req.correlationId,
  });
}


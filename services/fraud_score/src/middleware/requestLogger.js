import pinoHttp from "pino-http";

export function requestLogger(logger) {
  return pinoHttp({
    logger,
    customProps: (req) => ({
      correlationId: req.correlationId,
    }),
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          headers: {
            "user-agent": req.headers["user-agent"],
            "x-model-version": req.headers["x-model-version"],
            "x-correlation-id": req.headers["x-correlation-id"],
          },
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  });
}


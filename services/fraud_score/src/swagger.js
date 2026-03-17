import swaggerJSDoc from "swagger-jsdoc";

export function buildSwaggerSpec({ serviceVersion, defaultModelVersion }) {
  return swaggerJSDoc({
    definition: {
      openapi: "3.0.3",
      info: {
        title: "Fraud Score Service",
        version: serviceVersion,
        description:
          "Stateless ML scoring service. Trains a lightweight model from a CSV at startup and provides fraud probability scores.",
      },
      servers: [{ url: "http://localhost:8001" }],
      components: {
        schemas: {
          ScoreRequest: {
            type: "object",
            required: ["amount", "currency", "card_type", "country", "hour_utc"],
            properties: {
              amount: { type: "number", example: 5000 },
              currency: { type: "string", example: "USD" },
              card_type: { type: "string", example: "VISA" },
              country: { type: "string", example: "US" },
              hour_utc: { type: "integer", minimum: 0, maximum: 23, example: 2 },
              velocity_txn_hour_raw: { type: "integer", example: 6 },
              geo_country_high_risk: { type: "boolean", example: false },
            },
          },
          ScoreResponse: {
            type: "object",
            properties: {
              fraud_probability: { type: "number", example: 0.22 },
              rules_score: { type: "integer", example: 22 },
              model_version: { type: "string", example: defaultModelVersion },
              fallback_used: { type: "boolean", example: false },
              explanation: { type: "object", nullable: true },
            },
          },
        },
      },
      paths: {
        "/health": {
          get: {
            summary: "Health check",
            responses: { 200: { description: "ok" } },
          },
        },
        "/model": {
          get: {
            summary: "Model info",
            parameters: [
              {
                name: "model_version",
                in: "query",
                schema: { type: "string", enum: ["v1", "v2"] },
              },
            ],
            responses: { 200: { description: "model" } },
          },
        },
        "/metrics": {
          get: { summary: "Prometheus metrics", responses: { 200: { description: "metrics" } } },
        },
        "/score": {
          post: {
            summary: "Return fraud probability score",
            parameters: [
              {
                name: "X-Model-Version",
                in: "header",
                schema: { type: "string", enum: ["v1", "v2"] },
              },
              {
                name: "model_version",
                in: "query",
                schema: { type: "string", enum: ["v1", "v2"] },
              },
              {
                name: "explain",
                in: "query",
                schema: { type: "boolean" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScoreRequest" },
                },
              },
            },
            responses: {
              200: {
                description: "score",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ScoreResponse" },
                  },
                },
              },
            },
          },
        },
      },
    },
    apis: [],
  });
}


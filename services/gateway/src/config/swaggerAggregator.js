const axios = require('axios');
const config = require('./index');

const docsUrl = (baseUrl) => {
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/$/, '')}/api-docs.json`;
};

const services = [
  {
    name: 'transaction-service',
    enabled: config.routeToggles.transactions,
    url: docsUrl(config.services.transaction),
    includePrefixes: ['/api/v1/transactions'],
  },
  {
    name: 'user-service',
    enabled: config.routeToggles.auth,
    url: docsUrl(config.services.user),
    includePrefixes: ['/api/v1/auth'],
  },
  {
    name: 'decision-engine-service',
    enabled: config.routeToggles.decisions,
    url: docsUrl(config.services.decisionEngine),
    includePrefixes: ['/api/v1/decisions', '/api/v1/thresholds'],
  },
  {
    name: 'audit-service',
    enabled: config.routeToggles.audit,
    url: docsUrl(config.services.audit),
    includePrefixes: ['/api/v1/audit'],
  },
  {
    name: 'analytics-service',
    enabled: config.routeToggles.analytics,
    url: docsUrl(config.services.analytics),
    includePrefixes: ['/api/v1/analytics'],
  },
  {
    name: 'human-verification-service',
    enabled: config.routeToggles.humanVerification,
    url: docsUrl(config.services.humanVerification),
    includePrefixes: ['/api/v1/reviews'],
  },
  {
    name: 'appeal-service',
    enabled: config.routeToggles.appeals,
    url: docsUrl(config.services.appeal),
    includePrefixes: ['/api/v1/appeals'],
  },
];

const gatewayPaths = {
  '/api/v1/health': {
    get: {
      tags: ['api-gateway'],
      summary: 'API Gateway health status',
      responses: {
        200: { description: 'Gateway healthy' },
        503: { description: 'Gateway degraded/unhealthy' },
      },
    },
  },
  '/api/v1/health/live': {
    get: {
      tags: ['api-gateway'],
      summary: 'API Gateway liveness probe',
      responses: {
        200: { description: 'Gateway process alive' },
      },
    },
  },
  '/api/v1/health/ready': {
    get: {
      tags: ['api-gateway'],
      summary: 'API Gateway readiness probe',
      responses: {
        200: { description: 'Gateway ready' },
        503: { description: 'Gateway not ready' },
      },
    },
  },
  '/api/v1/metrics': {
    get: {
      tags: ['api-gateway'],
      summary: 'API Gateway metrics endpoint',
      responses: {
        200: { description: 'Metrics payload' },
      },
    },
  },
};

const shouldIncludePath = (path, includePrefixes) => {
  if (!includePrefixes || includePrefixes.length === 0) return true;
  return includePrefixes.some((prefix) => path.startsWith(prefix));
};

async function aggregateSwaggerSpecs() {
  const mergedSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Fraud Detection Platform API',
      version: '2.0.0'
    },
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {}
    }
  };

  Object.assign(mergedSpec.paths, gatewayPaths);

  for (const service of services) {
    if (service.enabled === false || !service.url) {
      continue;
    }

    try {
      const { data } = await axios.get(service.url, { timeout: 2000 });

      if (data.paths) {
        for (const [path, pathItem] of Object.entries(data.paths)) {
          if (!shouldIncludePath(path, service.includePrefixes)) continue;

          if (!mergedSpec.paths[path]) {
            mergedSpec.paths[path] = {};
          }

          for (const [method, operation] of Object.entries(pathItem)) {
            if (!mergedSpec.paths[path][method]) {
              mergedSpec.paths[path][method] = operation;
              continue;
            }

            console.warn(`Duplicate path/method skipped: ${method.toUpperCase()} ${path} from ${service.name}`);
          }
        }
      }

      if (data.components?.schemas) {
        Object.assign(mergedSpec.components.schemas, data.components.schemas);
      }

      if (data.components?.securitySchemes) {
        Object.assign(mergedSpec.components.securitySchemes, data.components.securitySchemes);
      }

      console.log(`Loaded Swagger from ${service.name}`);
    } catch (error) {
      console.warn(`Failed to load Swagger from ${service.name}`);
    }
  }

  return mergedSpec;
}

module.exports = aggregateSwaggerSpecs;

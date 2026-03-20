const client = require('prom-client');
const config = require('../config');
const logger = require('../config/logger');
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'service'],
  registers: [register],
});

const proxyRequestDuration = new client.Histogram({
  name: 'proxy_request_duration_seconds',
  help: 'Duration of proxied requests in seconds',
  labelNames: ['target_service', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register],
});

const proxyRequestErrors = new client.Counter({
  name: 'proxy_request_errors_total',
  help: 'Total number of proxy request errors',
  labelNames: ['target_service', 'error_type'],
  registers: [register],
});

const circuitBreakerState = new client.Gauge({
  name: 'circuit_breaker_state',
  help: 'Current state of circuit breakers (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
  registers: [register],
});

const activeConnections = new client.Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  registers: [register],
});

const rateLimitHits = new client.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint'],
  registers: [register],
});

const authenticationAttempts = new client.Counter({
  name: 'authentication_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['result'],
  registers: [register],
});

class MetricsService {
  static recordHttpRequest(method, route, statusCode, duration, service = 'api-gateway') {
    httpRequestDuration.labels(method, route, statusCode, service).observe(duration);
    httpRequestTotal.labels(method, route, statusCode, service).inc();
  }

  static recordProxyRequest(targetService, statusCode, duration) {
    proxyRequestDuration.labels(targetService, statusCode).observe(duration);
  }

  static recordProxyError(targetService, errorType) {
    proxyRequestErrors.labels(targetService, errorType).inc();
  }

  static setCircuitBreakerState(service, state) {
    const stateValue = { CLOSED: 0, OPEN: 1, HALF_OPEN: 2 }[state] || 0;
    circuitBreakerState.labels(service).set(stateValue);
  }

  static incrementActiveConnections() {
    activeConnections.inc();
  }

  static decrementActiveConnections() {
    activeConnections.dec();
  }

  static recordRateLimitHit(endpoint) {
    rateLimitHits.labels(endpoint).inc();
  }

  static recordAuthAttempt(result) {
    authenticationAttempts.labels(result).inc();
  }

  static getMetrics() {
    return register.metrics();
  }

  static getContentType() {
    return register.contentType;
  }
}

module.exports = MetricsService;
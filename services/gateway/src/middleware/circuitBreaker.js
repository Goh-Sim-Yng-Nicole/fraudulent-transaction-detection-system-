const CircuitBreaker = require('opossum');
const config = require('../config');
const logger = require('../config/logger');
const MetricsService = require('../utils/metrics');
const { ServiceUnavailableError } = require('../utils/errors');

const circuitBreakers = new Map();

// Handles create circuit breaker.
const createCircuitBreaker = (serviceName, action, options = {}) => {
  const defaultOptions = {
    timeout: config.circuitBreaker.timeout,
    errorThresholdPercentage: config.circuitBreaker.errorThresholdPercentage,
    resetTimeout: config.circuitBreaker.resetTimeout,
    name: serviceName,
  };

  const breaker = new CircuitBreaker(action, { ...defaultOptions, ...options });
  breaker.on('open', () => {
    logger.warn(`Circuit breaker opened for ${serviceName}`);
    MetricsService.setCircuitBreakerState(serviceName, 'OPEN');
  });

  breaker.on('halfOpen', () => {
    logger.info(`Circuit breaker half-open for ${serviceName}`);
    MetricsService.setCircuitBreakerState(serviceName, 'HALF_OPEN');
  });

  breaker.on('close', () => {
    logger.info(`Circuit breaker closed for ${serviceName}`);
    MetricsService.setCircuitBreakerState(serviceName, 'CLOSED');
  });

  breaker.on('success', (result) => {
    logger.debug(`Circuit breaker success for ${serviceName}`);
  });

  breaker.on('failure', (error) => {
    logger.error(`Circuit breaker failure for ${serviceName}:`, error);
  });

  breaker.on('timeout', () => {
    logger.warn(`Circuit breaker timeout for ${serviceName}`);
  });

  breaker.on('reject', () => {
    logger.warn(`Circuit breaker rejected request for ${serviceName}`);
  });

  breaker.on('fallback', (result) => {
    logger.info(`Circuit breaker fallback executed for ${serviceName}`);
  });

  circuitBreakers.set(serviceName, breaker);
  MetricsService.setCircuitBreakerState(serviceName, 'CLOSED');

  return breaker;
};

// Handles get circuit breaker.
const getCircuitBreaker = (serviceName) => {
  return circuitBreakers.get(serviceName);
};

// Handles with circuit breaker.
const withCircuitBreaker = (serviceName) => {
  return async (req, res, next) => {
    try {
      const breaker = getCircuitBreaker(serviceName);
      
      if (!breaker) {
        logger.warn(`No circuit breaker found for ${serviceName}`);
        return next();
      }

      if (breaker.opened) {
        throw new ServiceUnavailableError(`Service ${serviceName} is currently unavailable`);
      }

      req.circuitBreaker = breaker;
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  createCircuitBreaker,
  getCircuitBreaker,
  withCircuitBreaker,
  circuitBreakers,
};
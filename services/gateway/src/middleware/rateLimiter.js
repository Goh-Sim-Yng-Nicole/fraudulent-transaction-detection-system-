const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { getRedisClient } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const { TooManyRequestsError } = require('../utils/errors');
const MetricsService = require('../utils/metrics');

// Handles create rate limiter.
const createRateLimiter = (options = {}) => {
  const defaults = {
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: config.rateLimit.skipSuccessfulRequests,
    handler: (req, res) => {
      MetricsService.recordRateLimitHit(req.path);
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        userId: req.user?.userId,
      });
      throw new TooManyRequestsError('Too many requests, please try again later');
    },
    keyGenerator: (req) => {
      return req.user?.userId || req.ip;
    },
  };

  try {
    const redisClient = getRedisClient();
    
    return rateLimit({
      ...defaults,
      ...options,
      store: new RedisStore({
        client: redisClient,
        prefix: 'rl:',
      }),
    });
  } catch (error) {
    logger.error('Failed to create Redis-based rate limiter, falling back to memory store', error);
    return rateLimit({
      ...defaults,
      ...options,
    });
  }
};
const standardLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later',
});

const strictLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many requests, please slow down',
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts, please try again later',
});

const transactionLimiter = createRateLimiter({
  windowMs: config.transactionRateLimit.windowMs,
  max: config.transactionRateLimit.max,
  message: 'Transaction rate limit exceeded',
  keyGenerator: (req) => {
    const customerId = req.body?.customerId || req.user?.userId || req.ip;
    return `${config.transactionRateLimit.keyPrefix}${customerId}`;
  },
});

module.exports = {
  standardLimiter,
  strictLimiter,
  authLimiter,
  transactionLimiter,
  createRateLimiter,
};

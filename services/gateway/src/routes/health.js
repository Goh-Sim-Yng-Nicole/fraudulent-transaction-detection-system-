const express = require('express');
const config = require('../config');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');

const router = express.Router();

// Handles GET /health.
router.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'api-gateway',
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    dependencies: {},
  };

  if (config.redis.disabled) {
    health.dependencies.redis = {
      status: 'disabled',
      mode: 'in-memory-fallback',
    };
    return res.status(200).json(health);
  }

  try {
    const redisClient = getRedisClient();
    await redisClient.ping();
    health.dependencies.redis = { status: 'healthy' };
  } catch (error) {
    logger.error('Redis health check failed:', error);
    health.dependencies.redis = { status: 'unhealthy', error: error.message };
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Handles GET /health/ready.
router.get('/health/ready', async (req, res) => {
  if (config.redis.disabled) {
    return res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      dependencies: {
        redis: {
          status: 'disabled',
          mode: 'in-memory-fallback',
        },
      },
    });
  }

  try {
    const redisClient = getRedisClient();
    await redisClient.ping();
    
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// Handles GET /health/live.
router.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;

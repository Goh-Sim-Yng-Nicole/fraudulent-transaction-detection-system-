const router = require('express').Router();
const config = require('../config');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const logger = require('../config/logger');

/**
 * @openapi
 * /api/v1/health:
 *   get:
 *     tags: [notification-service]
 *     summary: Service health status
 *     responses:
 *       200:
 *         description: Service healthy
 *       503:
 *         description: Service degraded/unhealthy
 */
// Handles GET /health.
router.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'notification-service',
    uptime: Math.floor(process.uptime()),
    uptimeHuman: formatUptime(process.uptime()),
    memory: formatMemory(process.memoryUsage()),
    pid: process.pid,
    nodeVersion: process.version,
    dependencies: {},
  };

  let degraded = false;
  try {
    const emailHealthy = await emailService.verifyConnection();
    health.dependencies.email = {
      status: config.email.enabled ? (emailHealthy ? 'healthy' : 'degraded') : 'disabled',
      enabled: config.email.enabled,
      provider: config.email.provider,
      mode: config.email.provider === 'mock' ? 'mock' : 'external',
      fromAddress: config.email.from.address,
    };
    if (config.email.enabled && !emailHealthy) degraded = true;
  } catch (err) {
    logger.error('Email health check failed', { error: err.message });
    health.dependencies.email = { status: 'unhealthy', error: err.message };
    degraded = true;
  }
  try {
    const smsHealthy = await smsService.verifyConnection();
    health.dependencies.sms = {
      status: config.sms.enabled ? (smsHealthy ? 'healthy' : 'degraded') : 'disabled',
      enabled: config.sms.enabled,
      provider: config.sms.provider,
      mode: config.sms.provider === 'mock' ? 'mock' : 'external',
      sender: config.sms.twilio.phoneNumber || config.contacts.fraudTeam.phone,
    };
    if (config.sms.enabled && !smsHealthy) degraded = true;
  } catch (err) {
    logger.error('SMS health check failed', { error: err.message });
    health.dependencies.sms = { status: 'unhealthy', error: err.message };
    degraded = true;
  }
  health.dependencies.kafka = {
    status: 'healthy',
    note: 'Consumer crash triggers process restart',
  };
  health.notificationProviders = {
    realProviderEnabled: (config.email.enabled && config.email.provider !== 'mock')
      || (config.sms.enabled && config.sms.provider !== 'mock'),
    customerFallbackEmail: config.contacts.customer.fallbackEmail,
    customerFallbackPhone: config.contacts.customer.fallbackPhone,
    fraudTeamEmail: config.contacts.fraudTeam.email,
    fraudTeamPhone: config.contacts.fraudTeam.phone,
  };

  health.status = degraded ? 'degraded' : 'healthy';
  res.status(degraded ? 503 : 200).json(health);
});

/**
 * @openapi
 * /api/v1/health/ready:
 *   get:
 *     tags: [notification-service]
 *     summary: Readiness probe
 *     responses:
 *       200:
 *         description: Service ready
 *       503:
 *         description: Service not ready
 */
// Handles GET /health/ready.
router.get('/health/ready', async (req, res) => {
  try {
    const emailHealthy = await emailService.verifyConnection();
    const smsHealthy = await smsService.verifyConnection();
    const emailAvailable = config.email.enabled && emailHealthy;
    const smsAvailable = config.sms.enabled && smsHealthy;

    if (!emailAvailable && !smsAvailable) {
      return res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: 'No notification channels available',
      });
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: err.message,
    });
  }
});

/**
 * @openapi
 * /api/v1/health/live:
 *   get:
 *     tags: [notification-service]
 *     summary: Liveness probe
 *     responses:
 *       200:
 *         description: Process alive
 */
// Handles GET /health/live.
router.get('/health/live', (_req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    pid: process.pid,
  });
});

// Handles format uptime.
const formatUptime = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
};

// Handles format memory.
const formatMemory = (mem) => ({
  rss: `${(mem.rss / 1024 / 1024).toFixed(1)}MB`,
  heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
  heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`,
  external: `${(mem.external / 1024 / 1024).toFixed(1)}MB`,
});

module.exports = router;

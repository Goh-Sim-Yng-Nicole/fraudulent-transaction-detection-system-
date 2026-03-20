require('express-async-errors');
require('dotenv').config();
require('./config/tracing');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const http = require('http');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const swaggerSpec = require('./config/swagger');
const logger = require('./config/logger');
const { createClient, closeClient } = require('./config/redis');
const eventConsumerService = require('./services/eventConsumerService');
const websocketService = require('./services/websocketService');
const routes = require('./routes');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// Security
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for dashboard
}));
app.use(cors());
app.use(compression());

// Parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/v1', routes);
app.use('/', routes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (req, res) => {
  res.json(swaggerSpec);
});

// Serve dashboard on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `${req.method} ${req.path} not found`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled request error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    success: false,
    error: config.env === 'production' ? 'Internal server error' : err.message,
  });
});

// Graceful Shutdown
let isShuttingDown = false;

// Handles shutdown.
const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received - starting graceful shutdown`);

  websocketService.stop();

  server.close(() => {
    logger.info('HTTP server closed');
  });

  try {
    await eventConsumerService.stop();
    logger.info('Analytics Kafka consumer stopped');
  } catch (err) {
    logger.error('Error stopping analytics Kafka consumer', { error: err.message });
  }

  try {
    await closeClient();
    logger.info('Redis connection closed');
  } catch (err) {
    logger.error('Error closing Redis', { error: err.message });
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
};

// Handles force exit timer.
const forceExitTimer = (signal) => {
  setTimeout(() => {
    logger.error(`Forced exit after 30s shutdown timeout (signal: ${signal})`);
    process.exit(1);
  }, 30000).unref();
};

process.on('SIGTERM', () => { forceExitTimer('SIGTERM'); shutdown('SIGTERM'); });
process.on('SIGINT', () => { forceExitTimer('SIGINT'); shutdown('SIGINT'); });
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  forceExitTimer('uncaughtException');
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
  forceExitTimer('unhandledRejection');
  shutdown('unhandledRejection');
});

// Bootstrap
const bootstrap = async () => {
  try {
    logger.info('Bootstrapping Analytics Service', {
      env: config.env,
      version: config.serviceVersion,
      node: process.version,
    });

    // Redis projection store
    await createClient();
    logger.info('Redis initialized');

    await eventConsumerService.start();

    // WebSocket service
    websocketService.initialize(server);

    // HTTP server
    server.listen(config.port, () => {
      logger.info('Analytics Service listening', {
        port: config.port,
        dashboard: `http://localhost:${config.port}`,
        api: `http://localhost:${config.port}/api/v1`,
      });
    });

    server.on('error', (err) => {
      logger.error('HTTP server error', { error: err.message });
      process.exit(1);
    });

    logger.info('Bootstrap complete - dashboard is ready!');
  } catch (err) {
    logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();

module.exports = app;


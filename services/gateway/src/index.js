require('express-async-errors');
require('./config/tracing');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const logger = require('./config/logger');
const { createRedisClient, closeRedisConnection } = require('./config/redis');
const aggregateSwaggerSpecs = require('./config/swaggerAggregator');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const { attachRequestMetadata } = require('./middleware/requestValidator');

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors(config.cors));
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Custom middleware
app.use(attachRequestMetadata);
app.use(requestLogger);

// Routes
app.use('/api/v1', routes);
app.use('/', routes);
app.get('/api-docs.json', async (req, res, next) => {
  try {
    const swaggerSpec = await aggregateSwaggerSpecs();
    res.json(swaggerSpec);
  } catch (error) {
    next(error);
  }
});
app.use('/api-docs', swaggerUi.serve);
app.use('/api-docs', async (req, res, next) => {
  try {
    const swaggerSpec = await aggregateSwaggerSpecs();
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Fraud Detection REST API Documentation',
      swaggerOptions: {
        supportedSubmitMethods: [],
        docExpansion: 'list',
        defaultModelRendering: 'example',
        defaultModelsExpandDepth: 1,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    })(req, res, next);
  } catch (error) {
    next(error);
  }
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, starting graceful shutdown`);

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 30000).unref();

  try {
    await new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });
    });

    await closeRedisConnection();
    logger.info('All connections closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
  gracefulShutdown('unhandledRejection');
});

// Start server
let server;

// Handles start server.
const startServer = async () => {
  try {
    // Initialize Redis connection
    await createRedisClient();
    logger.info('Redis connection established');

    // Start HTTP server
    server = app.listen(config.port, () => {
      logger.info(`API Gateway started successfully`, {
        port: config.port,
        environment: config.env,
        nodeVersion: process.version,
      });
    });
    server.on('error', (error) => {
      logger.error('HTTP server error', { error: error.message });
      process.exit(1);
    });

    // Start metrics server if enabled
    if (config.metrics.enabled) {
      const metricsApp = express();
      metricsApp.get('/metrics', async (req, res) => {
        const MetricsService = require('./utils/metrics');
        res.set('Content-Type', MetricsService.getContentType());
        res.end(await MetricsService.getMetrics());
      });

      metricsApp.listen(config.metrics.port, () => {
        logger.info(`Metrics server started on port ${config.metrics.port}`);
      });
    }
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;


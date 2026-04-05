'use strict';
require('express-async-errors');
require('./config/tracing');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const swaggerSpec = require('./config/swagger');
const logger = require('./config/logger');
const { createPool, closePool } = require('./db/pool');
const { createProducer } = require('./config/kafka');
const appealService = require('./services/appealService');
const { start: startTxnConsumer, stop: stopTxnConsumer } = require('./consumers/transactionConsumer');
const routes = require('./routes');
const legacyRoutes = require('./routes/legacyAppeals');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/v1', routes);
app.use('/', legacyRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

app.use(notFoundHandler);
app.use(errorHandler);

let server = null;
let producer = null;
let isShuttingDown = false;

// Handles shutdown.
const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received - shutting down`);

  try {
    await new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });
    });

    try {
      await stopTxnConsumer();
    } catch (err) {
      logger.error('Error stopping transaction consumer', { error: err.message });
    }
    try {
      if (producer) await producer.disconnect();
    } catch (err) {
      logger.error('Error disconnecting Kafka producer', { error: err.message });
    }

    await closePool();
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message, stack: err.stack });
    process.exit(1);
  }
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
  logger.error('Unhandled rejection', { reason: String(reason) });
  forceExitTimer('unhandledRejection');
  shutdown('unhandledRejection');
});

// Handles bootstrap.
const bootstrap = async () => {
  createPool();
  producer = await createProducer();
  appealService.setProducer(producer);
  await startTxnConsumer();

  server = app.listen(config.port, () => {
    logger.info(`Appeal Service listening on port ${config.port}`, {
      env: config.env,
      node: process.version,
    });
  });

  server.on('error', (err) => {
    logger.error('HTTP server error', { error: err.message });
    process.exit(1);
  });
};

bootstrap().catch((err) => {
  logger.error('Failed to bootstrap service', { error: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = app;

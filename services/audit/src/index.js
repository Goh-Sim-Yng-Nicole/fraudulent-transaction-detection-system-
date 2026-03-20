require('express-async-errors');
require('dotenv').config();
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
const auditConsumer = require('./consumers/auditConsumer');
const routes = require('./routes');

const app = express();

app.set('trust proxy', 1);

// Security & Performance
app.use(helmet());
app.use(cors());
app.use(compression());

// Parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/v1', routes);
app.use('/', routes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (req, res) => {
  res.json(swaggerSpec);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: `${req.method} ${req.path} not found` });
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
let server;
let isShuttingDown = false;

// Handles shutdown.
const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received – starting graceful shutdown`);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
    logger.info('HTTP server closed');
  }

  try {
    await auditConsumer.stop();
    logger.info('Kafka consumer stopped');
  } catch (err) {
    logger.error('Error stopping Kafka consumer', { error: err.message });
  }

  try {
    await closePool();
    logger.info('Database pool closed');
  } catch (err) {
    logger.error('Error closing database pool', { error: err.message });
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
    logger.info('Bootstrapping Audit Service', {
      env: config.env,
      version: config.serviceVersion,
      node: process.version,
    });

    // Database pool
    createPool();
    logger.info('Database pool initialized');

    // Ensure Kafka topics exist before consuming
    const { createKafka } = require('./config/kafka');
    const kafkaAdmin = createKafka().admin();
    await kafkaAdmin.connect();
    await kafkaAdmin.createTopics({
      waitForLeaders: true,
      topics: config.kafka.topics.map(topic => ({
        topic,
        numPartitions: 1,
        replicationFactor: 1,
      })),
    });
    await kafkaAdmin.disconnect();
    logger.info('Kafka topics verified/created', { topics: config.kafka.topics });

    // Kafka consumer
    await auditConsumer.start();
    logger.info('Kafka consumer started - logging all events');

    // HTTP server
    server = app.listen(config.port, () => {
      logger.info('Audit Service listening', { port: config.port });
    });

    server.on('error', (err) => {
      logger.error('HTTP server error', { error: err.message });
      process.exit(1);
    });

    logger.info('Bootstrap complete – audit service is ready');
  } catch (err) {
    logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();

module.exports = app;


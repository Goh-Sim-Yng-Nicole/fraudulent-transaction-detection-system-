require('express-async-errors');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const logger = require('./config/logger');
const swaggerSpec = require('./config/swagger');
const requestContext = require('./middleware/requestContext');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const { createPool, closePool } = require('./db/pool');
const migrate = require('./db/migrate');
const { createProducer, disconnectProducer } = require('./kafka/producer');
const decisionConsumer = require('./kafka/decisionConsumer');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);

app.use('/api/v1', routes);
app.use('/', routes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

app.use(notFoundHandler);
app.use(errorHandler);

let server = null;

const shutdown = async (signal) => {
  logger.info('Shutting down transaction service', { signal });
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await decisionConsumer.stop();
  await disconnectProducer();
  await closePool();
  process.exit(0);
};

const bootstrap = async () => {
  await migrate();
  createPool();
  await createProducer();
  await decisionConsumer.start();

  server = app.listen(config.port, () => {
    logger.info('Transaction service listening', {
      port: config.port,
      env: config.env
    });
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((error) => {
  logger.error('Transaction bootstrap failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = app;

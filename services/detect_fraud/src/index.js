require('express-async-errors');
require('./config/tracing');

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const logger = require('./config/logger');
const swaggerSpec = require('./config/swagger');
const routes = require('./routes');
const transactionConsumer = require('./consumers/transactionConsumer');

const app = express();
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));

app.use('/api/v1', routes);
app.use('/', routes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

let server = null;

const shutdown = async (signal) => {
  logger.info('Shutting down fraud detection service', { signal });
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await transactionConsumer.stop();
  process.exit(0);
};

const bootstrap = async () => {
  await transactionConsumer.start();
  server = app.listen(config.port, () => {
    logger.info('Fraud detection service listening', {
      port: config.port,
      env: config.env
    });
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((error) => {
  logger.error('Fraud detection bootstrap failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = app;

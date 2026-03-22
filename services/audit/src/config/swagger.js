const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: process.env.SERVICE_NAME || 'Service API',
      version: process.env.SERVICE_VERSION || '1.0.0'
    }
  },
  apis: ['./src/routes/**/*.js']
};

module.exports = swaggerJsdoc(options);

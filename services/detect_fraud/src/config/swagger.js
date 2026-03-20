const config = require('./index');

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'FTDS Fraud Detection Service',
    version: config.serviceVersion
  },
  servers: [{ url: '/' }]
};

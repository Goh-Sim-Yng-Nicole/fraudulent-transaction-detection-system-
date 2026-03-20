const config = require('./index');

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'FTDS Transaction Service',
    version: config.serviceVersion,
    description: 'Transaction lifecycle service with compatibility routes for the FTDS banking UI.'
  },
  servers: [{ url: '/' }]
};

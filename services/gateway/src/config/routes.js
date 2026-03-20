const config = require('./index');
const serviceRoutes = {
  '/api/v1/transactions': {
    target: config.services.transaction,
    pathRewrite: { '^/api/v1/transactions': '/api/v1/transactions' },
    serviceName: 'transaction-service',
  },
  '/api/v1/audit': {
    target: config.services.audit,
    pathRewrite: { '^/api/v1/audit': '/api/v1/audit' },
    serviceName: 'audit-service',
  },
  '/api/v1/analytics': {
    target: config.services.analytics,
    pathRewrite: { '^/api/v1/analytics': '/api/v1/analytics' },
    serviceName: 'analytics-service',
  },
};

module.exports = serviceRoutes;
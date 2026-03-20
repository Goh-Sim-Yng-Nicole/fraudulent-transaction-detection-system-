const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');
const MetricsService = require('../utils/metrics');
const { ServiceUnavailableError, GatewayTimeoutError } = require('../utils/errors');

class ProxyService {
  static async proxyRequest(targetUrl, method, data, headers, options = {}) {
    const startTime = Date.now();
    const serviceName = options.serviceName || 'unknown';

    try {
      logger.debug('Proxying request', {
        targetUrl,
        method,
        serviceName,
      });

      const response = await axios({
        url: targetUrl,
        method,
        data,
        headers: {
          ...headers,
          'X-Forwarded-For': options.clientIp,
          'X-Forwarded-Proto': 'https',
        },
        timeout: config.proxy.timeout,
        validateStatus: () => true,
      });

      const duration = (Date.now() - startTime) / 1000;
      MetricsService.recordProxyRequest(serviceName, response.status.toString(), duration);

      logger.debug('Proxy request successful', {
        serviceName,
        statusCode: response.status,
        duration: `${duration}s`,
      });

      return {
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        logger.error('Proxy request timeout', {
          serviceName,
          error: error.message,
          duration: `${duration}s`,
        });
        MetricsService.recordProxyError(serviceName, 'timeout');
        throw new GatewayTimeoutError(`Request to ${serviceName} timed out`);
      }

      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        logger.error('Proxy request connection failed', {
          serviceName,
          error: error.message,
        });
        MetricsService.recordProxyError(serviceName, 'connection_refused');
        throw new ServiceUnavailableError(`Service ${serviceName} is unavailable`);
      }

      logger.error('Proxy request error', {
        serviceName,
        error: error.message,
        duration: `${duration}s`,
      });
      MetricsService.recordProxyError(serviceName, 'unknown_error');

      throw new ServiceUnavailableError(`Failed to proxy request to ${serviceName}`);
    }
  }

  static async proxyWithRetry(targetUrl, method, data, headers, options = {}) {
    const maxAttempts = options.maxAttempts || config.proxy.retryAttempts;
    const retryDelay = options.retryDelay || config.proxy.retryDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.proxyRequest(targetUrl, method, data, headers, options);
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }

        logger.warn('Proxy request failed, retrying', {
          attempt,
          maxAttempts,
          serviceName: options.serviceName,
          error: error.message,
        });
        await new Promise((resolve) => 
          setTimeout(resolve, retryDelay * Math.pow(2, attempt - 1))
        );
      }
    }
  }
}

module.exports = ProxyService;
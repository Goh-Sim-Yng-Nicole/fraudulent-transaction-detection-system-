const config = require('../config');
const logger = require('../config/logger');

class CustomerContactService {
  async getContact(customerId) {
    if (!customerId) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.customerService.timeoutMs);

    try {
      const response = await fetch(
        `${config.customerService.baseUrl}/internal/contact/${encodeURIComponent(customerId)}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        logger.warn('Customer contact lookup failed', {
          customerId,
          status: response.status,
        });
        return null;
      }

      const contact = await response.json();
      return {
        email: contact?.email || null,
        phone: contact?.phone || null,
      };
    } catch (error) {
      logger.warn('Customer contact lookup error', {
        customerId,
        error: error.message,
      });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = new CustomerContactService();

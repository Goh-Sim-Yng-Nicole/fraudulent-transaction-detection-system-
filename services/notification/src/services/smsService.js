const config = require('../config');
const logger = require('../config/logger');

class SmsService {
  constructor() {
    this.client = null;
    this.provider = config.sms.provider;
    this._initialize();
  }

  // Handles initialize.
  _initialize() {
    if (!config.sms.enabled) {
      logger.info('SMS notifications disabled');
      return;
    }

    if (this.provider === 'mock') {
      logger.info('SMS provider: MOCK (logging only)');
      this.client = {
        messages: {
          create: async (options) => {
            logger.info('📱 [MOCK SMS SENT]', {
              to: options.to,
              from: options.from,
              body: options.body?.substring(0, 60) + '...',
            });
            return { sid: `mock-sms-${Date.now()}` };
          },
        },
      };
    } else if (this.provider === 'twilio') {
      logger.info('SMS provider: Twilio');
      
      if (!config.sms.twilio.accountSid || !config.sms.twilio.authToken) {
        throw new Error('Twilio credentials missing');
      }

      const twilio = require('twilio');
      this.client = twilio(
        config.sms.twilio.accountSid,
        config.sms.twilio.authToken
      );
    } else {
      logger.error('Unknown SMS provider', { provider: this.provider });
      throw new Error(`Unknown SMS provider: ${this.provider}`);
    }
  }

  
  // Handles send sms.
  async sendSms({ to, body }) {
    if (!config.sms.enabled) {
      throw new Error('SMS service is disabled');
    }

    const smsOptions = {
      to,
      from: config.sms.twilio.phoneNumber || '+1234567890',
      body,
    };

    try {
      const message = await this.client.messages.create(smsOptions);
      
      logger.info('SMS sent successfully', {
        to,
        messageId: message.sid,
        provider: this.provider,
      });

      return {
        success: true,
        messageId: message.sid,
        provider: this.provider,
      };
    } catch (error) {
      logger.error('SMS send failed', {
        to,
        error: error.message,
        provider: this.provider,
      });
      throw error;
    }
  }

  
  // Handles verify connection.
  async verifyConnection() {
    if (!config.sms.enabled || this.provider === 'mock') {
      return true;
    }

    try {
      if (this.client && this.client.api) {
        await this.client.api.accounts(config.sms.twilio.accountSid).fetch();
      }
      return true;
    } catch (error) {
      logger.error('SMS connection verification failed', { error: error.message });
      return false;
    }
  }
}

module.exports = new SmsService();
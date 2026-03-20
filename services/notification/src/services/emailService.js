const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../config/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.provider = config.email.provider;
    this._initialize();
  }

  // Handles initialize.
  _initialize() {
    if (!config.email.enabled) {
      logger.info('Email notifications disabled');
      return;
    }

    if (this.provider === 'mock') {
      logger.info('Email provider: MOCK (logging only)');
      this.transporter = {
        sendMail: async (options) => {
          logger.info('📧 [MOCK EMAIL SENT]', {
            to: options.to,
            from: options.from,
            subject: options.subject,
            text: options.text?.substring(0, 100) + '...',
          });
          return { messageId: `mock-${Date.now()}` };
        },
      };
    } else if (this.provider === 'smtp') {
      logger.info('Email provider: SMTP', {
        host: config.email.smtp.host,
        port: config.email.smtp.port,
      });

      const transportOptions = {
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
      };
      if (config.email.smtp.user && config.email.smtp.password) {
        transportOptions.auth = {
          user: config.email.smtp.user,
          pass: config.email.smtp.password,
        };
      }

      this.transporter = nodemailer.createTransport(transportOptions);
    } else {
      logger.error('Unknown email provider', { provider: this.provider });
      throw new Error(`Unknown email provider: ${this.provider}`);
    }
  }

  
  // Handles send email.
  async sendEmail({ to, subject, text, html }) {
    if (!config.email.enabled) {
      throw new Error('Email service is disabled');
    }

    const mailOptions = {
      from: `${config.email.from.name} <${config.email.from.address}>`,
      to,
      subject,
      text,
      html,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      
      logger.info('Email sent successfully', {
        to,
        subject,
        messageId: info.messageId,
        provider: this.provider,
      });

      return {
        success: true,
        messageId: info.messageId,
        provider: this.provider,
      };
    } catch (error) {
      logger.error('Email send failed', {
        to,
        subject,
        error: error.message,
        provider: this.provider,
      });
      throw error;
    }
  }

  
  // Handles verify connection.
  async verifyConnection() {
    if (!config.email.enabled || this.provider === 'mock') {
      return true;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      logger.error('Email connection verification failed', { error: error.message });
      return false;
    }
  }
}

module.exports = new EmailService();
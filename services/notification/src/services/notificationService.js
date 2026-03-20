const config = require('../config');
const logger = require('../config/logger');
const emailService = require('./emailService');
const smsService = require('./smsService');
const { renderDeclinedCustomerEmail, renderDeclinedFraudTeamEmail, renderFlaggedFraudTeamEmail } = require('../templates/emailTemplates');
const { retryWithBackoff } = require('../utils/retry');

class NotificationService {
  // Handles process decision.
  async processDecision(decisionEvent) {
    const { decision, transactionId, customerId } = decisionEvent;

    logger.info('Processing notification', {
      transactionId,
      customerId,
      decision,
    });

    const notifications = [];
    if (decision === 'DECLINED' && config.notificationRules.notifyOnDeclined) {
      notifications.push(...this._getDeclinedNotifications(decisionEvent));
    } else if (decision === 'FLAGGED' && config.notificationRules.notifyOnFlagged) {
      notifications.push(...this._getFlaggedNotifications(decisionEvent));
    } else if (decision === 'APPROVED' && config.notificationRules.notifyOnApproved) {
      notifications.push(...this._getApprovedNotifications(decisionEvent));
    }
    const results = await Promise.allSettled(
      notifications.map(notification => this._sendWithRetry(notification))
    );
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const failed = results.filter(r => r.status === 'rejected' || !r.value.success);

    logger.info('Notifications processed', {
      transactionId,
      total: notifications.length,
      successful: successful.length,
      failed: failed.length,
    });

    return {
      total: notifications.length,
      successful: successful.length,
      failed: failed.length,
      results,
    };
  }

  // Handles get declined notifications.
  _getDeclinedNotifications(event) {
    const notifications = [];
    const { transactionId, customerId, originalTransaction, fraudAnalysis, decision, decisionReason, decisionFactors } = event;
    const customerEmail = this._resolveCustomerEmail(event);
    const customerPhone = this._resolveCustomerPhone(event);
    const templateData = {
      transactionId,
      customerId,
      merchantId: originalTransaction?.merchantId || 'Unknown',
      amount: originalTransaction?.amount || 0,
      currency: originalTransaction?.currency || 'USD',
      location: originalTransaction?.location?.country || 'Unknown',
      timestamp: event.decidedAt || new Date().toISOString(),
      riskScore: fraudAnalysis?.riskScore || 0,
      mlScore: fraudAnalysis?.mlResults?.score || 0,
      fraudFlagged: fraudAnalysis?.flagged ? 'Yes' : 'No',
      decision,
      decisionReason,
      decisionFactors: decisionFactors || {},
    };
    if (config.notificationRules.declined.notifyCustomerEmail) {
      const emailContent = renderDeclinedCustomerEmail(templateData);
      notifications.push({
        type: 'email',
        recipient: 'customer',
        to: customerEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        metadata: { transactionId, decision },
      });
    }
    if (config.notificationRules.declined.notifyCustomerSms) {
      notifications.push({
        type: 'sms',
        recipient: 'customer',
        to: customerPhone,
        body: `[Fraud Alert] Your transaction for $${templateData.amount} was declined. Transaction ID: ${transactionId.substring(0, 8)}. If unauthorized, no action needed. For help: fraud@example.com`,
        metadata: { transactionId, decision },
      });
    }
    if (config.notificationRules.declined.notifyFraudTeamEmail) {
      const emailContent = renderDeclinedFraudTeamEmail(templateData);
      notifications.push({
        type: 'email',
        recipient: 'fraud_team',
        to: this._resolveFraudTeamEmail(),
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        metadata: { transactionId, decision },
      });
    }

    return notifications;
  }

  // Handles get flagged notifications.
  _getFlaggedNotifications(event) {
    const notifications = [];
    const { transactionId, customerId, originalTransaction, fraudAnalysis, decision, decisionReason, decisionFactors } = event;

    const templateData = {
      transactionId,
      customerId,
      merchantId: originalTransaction?.merchantId || 'Unknown',
      amount: originalTransaction?.amount || 0,
      currency: originalTransaction?.currency || 'USD',
      riskScore: fraudAnalysis?.riskScore || 0,
      decision,
      decisionReason,
      decisionFactors: decisionFactors || {},
    };
    if (config.notificationRules.flagged.notifyFraudTeamEmail) {
      const emailContent = renderFlaggedFraudTeamEmail(templateData);
      notifications.push({
        type: 'email',
        recipient: 'fraud_team',
        to: this._resolveFraudTeamEmail(),
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        metadata: { transactionId, decision },
      });
    }
    if (config.notificationRules.flagged.notifyFraudTeamSms) {
      notifications.push({
        type: 'sms',
        recipient: 'fraud_team',
        to: this._resolveFraudTeamPhone(),
        body: `[Manual Review] Transaction ${transactionId.substring(0, 8)} flagged. Amount: $${templateData.amount}. Risk: ${templateData.riskScore}/100. Review now.`,
        metadata: { transactionId, decision },
      });
    }

    return notifications;
  }

  // Handles get approved notifications.
  _getApprovedNotifications(event) {
    return [];
  }

  // Handles send with retry.
  async _sendWithRetry(notification) {
    const { type, to, metadata } = notification;

    logger.info('Sending notification', {
      type,
      recipient: notification.recipient,
      to,
      transactionId: metadata.transactionId,
    });

    // Handles operation.
    const operation = async () => {
      if (type === 'email') {
        return await emailService.sendEmail({
          to: notification.to,
          subject: notification.subject,
          text: notification.text,
          html: notification.html,
        });
      } else if (type === 'sms') {
        return await smsService.sendSms({
          to: notification.to,
          body: notification.body,
        });
      } else {
        throw new Error(`Unknown notification type: ${type}`);
      }
    };

    const result = await retryWithBackoff(
      operation,
      {},
      {
        type,
        recipient: notification.recipient,
        transactionId: metadata.transactionId,
      }
    );

    if (!result.success) {
      logger.error('Notification failed after all retries', {
        type,
        to,
        transactionId: metadata.transactionId,
        error: result.error?.message,
        attempts: result.attempt,
      });
    }

    return result;
  }

  _resolveCustomerEmail(event) {
    return event.customerEmail
      || event.originalTransaction?.metadata?.notificationEmail
      || event.originalTransaction?.metadata?.customerEmail
      || config.contacts.customer.fallbackEmail;
  }

  _resolveCustomerPhone(event) {
    return event.customerPhone
      || event.originalTransaction?.metadata?.notificationPhone
      || event.originalTransaction?.metadata?.customerPhone
      || config.contacts.customer.fallbackPhone;
  }

  _resolveFraudTeamEmail() {
    return config.contacts.fraudTeam.email;
  }

  _resolveFraudTeamPhone() {
    return config.contacts.fraudTeam.phone;
  }
}

module.exports = new NotificationService();

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadCommonJsWithMocks } from './loadCommonJsWithMocks.mjs';

function loadNotificationService() {
  const sentEmails = [];
  const sentSms = [];
  const lookedUpCustomerIds = [];
  const captured = {
    approvedCustomer: null,
    flaggedCustomer: null,
    flaggedFraudTeam: null,
  };

  const notificationService = loadCommonJsWithMocks(
    './services/notification/src/services/notificationService.js',
    {
      '../config': {
        notificationRules: {
          notifyOnApproved: true,
          notifyOnDeclined: true,
          notifyOnFlagged: true,
          approved: {
            notifyCustomerEmail: true,
            notifyCustomerSms: false,
          },
          declined: {
            notifyCustomerEmail: true,
            notifyCustomerSms: false,
            notifyFraudTeamEmail: true,
          },
          flagged: {
            notifyCustomerEmail: true,
            notifyCustomerSms: false,
            notifyFraudTeamEmail: true,
            notifyFraudTeamSms: false,
          },
        },
        contacts: {
          customer: {
            fallbackEmail: 'customer@example.com',
            fallbackPhone: '+15550000000',
          },
          fraudTeam: {
            email: 'fraud-team@example.com',
            phone: '+15550000001',
          },
        },
        customerPortalUrl: 'http://localhost:8088/banking.html',
        customerService: {
          baseUrl: 'http://customer:8005',
          timeoutMs: 5000,
        },
      },
      '../config/logger': {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      './emailService': {
        sendEmail: async (payload) => {
          sentEmails.push(payload);
          return { success: true };
        },
      },
      './smsService': {
        sendSms: async (payload) => {
          sentSms.push(payload);
          return { success: true };
        },
      },
      './customerContactService': {
        getContact: async (customerId) => {
          lookedUpCustomerIds.push(customerId);
          if (customerId === 'oauth-customer-1') {
            return {
              email: 'oauth-customer@example.com',
              phone: '+6591234567',
            };
          }
          return null;
        },
      },
      '../templates/emailTemplates': {
        renderApprovedCustomerEmail: (data) => {
          captured.approvedCustomer = data;
          return { subject: 'approved', text: 'approved', html: '<p>approved</p>' };
        },
        renderDeclinedCustomerEmail: () => ({ subject: 'declined-customer', text: 'declined', html: '<p>declined</p>' }),
        renderDeclinedFraudTeamEmail: () => ({ subject: 'declined-team', text: 'declined-team', html: '<p>declined-team</p>' }),
        renderFlaggedCustomerEmail: (data) => {
          captured.flaggedCustomer = data;
          return { subject: 'flagged-customer', text: 'flagged-customer', html: '<p>flagged-customer</p>' };
        },
        renderFlaggedFraudTeamEmail: (data) => {
          captured.flaggedFraudTeam = data;
          return { subject: 'flagged-team', text: 'flagged-team', html: '<p>flagged-team</p>' };
        },
      },
      '../utils/retry': {
        retryWithBackoff: async (operation) => operation(),
      },
    }
  );

  return { notificationService, sentEmails, sentSms, captured, lookedUpCustomerIds };
}

test('flagged decisions notify both the customer and fraud team with richer reason context', async () => {
  const { notificationService, sentEmails, sentSms, captured } = loadNotificationService();

  const result = await notificationService.processDecision({
    transactionId: 'txn-flagged-001',
    customerId: 'customer-1',
    customerEmail: 'customer-1@example.com',
    decision: 'FLAGGED',
    decisionReason: '',
    originalTransaction: {
      merchantId: 'FTDS_FLAGGED_DEMO',
      amount: 3200,
      currency: 'USD',
      location: { country: 'NG' },
    },
    fraudAnalysis: {
      riskScore: 87,
      flagged: true,
      reasons: [
        'high-risk geography (NG)',
        'high-value payment to a recipient not seen in recent activity (recipient-7)',
        'high-risk merchant pattern detected (FTDS_FLAGGED_DEMO)',
      ],
      mlResults: { score: 84 },
    },
  });

  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(sentEmails.length, 2);
  assert.equal(sentSms.length, 0);
  assert.deepEqual(sentEmails.map((email) => email.to), [
    'customer-1@example.com',
    'fraud-team@example.com',
  ]);
  assert.equal(
    captured.flaggedCustomer.decisionReason,
    'high-risk geography (NG); high-value payment to a recipient not seen in recent activity (recipient-7); high-risk merchant pattern detected (FTDS_FLAGGED_DEMO)'
  );
  assert.deepEqual(captured.flaggedCustomer.reasonHighlights, [
    'high-risk geography (NG)',
    'high-value payment to a recipient not seen in recent activity (recipient-7)',
    'high-risk merchant pattern detected (FTDS_FLAGGED_DEMO)',
  ]);
  assert.equal(captured.flaggedFraudTeam.referenceId, 'TXN-FLAG');
});

test('approved decisions notify the customer with a portal link and support contacts', async () => {
  const { notificationService, sentEmails, captured } = loadNotificationService();

  const result = await notificationService.processDecision({
    transactionId: 'txn-approved-001',
    customerId: 'customer-2',
    customerEmail: 'customer-2@example.com',
    decision: 'APPROVED',
    originalTransaction: {
      merchantId: 'trusted-merchant',
      amount: 82,
      currency: 'SGD',
      location: { country: 'SG' },
    },
    fraudAnalysis: {
      riskScore: 18,
      flagged: false,
      reasons: ['trusted recipient pattern', 'normal geography (SG)'],
      mlResults: { score: 12 },
    },
  });

  assert.equal(result.total, 1);
  assert.equal(result.successful, 1);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'customer-2@example.com');
  assert.equal(captured.approvedCustomer.portalUrl, 'http://localhost:8088/banking.html');
  assert.equal(captured.approvedCustomer.supportEmail, 'fraud-team@example.com');
  assert.equal(captured.approvedCustomer.referenceId, 'TXN-APPR');
});

test('declined decisions resolve missing OAuth customer email from the customer service before falling back', async () => {
  const { notificationService, sentEmails, lookedUpCustomerIds } = loadNotificationService();

  const result = await notificationService.processDecision({
    transactionId: 'txn-declined-001',
    customerId: 'oauth-customer-1',
    decision: 'DECLINED',
    originalTransaction: {
      amount: 910,
      currency: 'SGD',
      location: { country: 'SG' },
    },
    fraudAnalysis: {
      riskScore: 91,
      flagged: false,
      reasons: ['risk score exceeded decline threshold'],
    },
  });

  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.deepEqual(lookedUpCustomerIds, ['oauth-customer-1']);
  assert.equal(sentEmails[0].to, 'oauth-customer@example.com');
  assert.equal(sentEmails[1].to, 'fraud-team@example.com');
});

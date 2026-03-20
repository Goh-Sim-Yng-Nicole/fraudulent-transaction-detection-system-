const transactionRepository = require('../repositories/transactionRepository');
const { publish } = require('../kafka/producer');
const config = require('../config');
const { TRANSACTION_STATUS } = require('../utils/constants');
const { NotFoundError } = require('../utils/errors');

const toFraudTransaction = (record) => ({
  id: record.transaction_id,
  customerId: record.customer_id,
  merchantId: record.merchant_id,
  amount: Number(record.amount),
  currency: record.currency,
  cardType: record.card_type,
  createdAt: record.created_at,
  location: {
    country: record.country
  },
  metadata: {
    senderName: record.sender_name,
    recipientCustomerId: record.recipient_customer_id,
    recipientName: record.recipient_name,
    hourUtc: record.hour_utc
  }
});

class TransactionService {
  async createTransaction(body, context) {
    if (context.idempotencyKey) {
      const existing = await transactionRepository.findByIdempotencyKey(context.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const now = new Date();
    const record = await transactionRepository.create({
      customerId: body.customerId,
      senderName: body.senderName || null,
      recipientCustomerId: body.recipientCustomerId || null,
      recipientName: body.recipientName || null,
      merchantId: body.merchantId || 'FTDS_TRANSFER',
      amount: body.amount,
      currency: String(body.currency || 'SGD').toUpperCase(),
      cardType: String(body.cardType || 'CREDIT').toUpperCase(),
      country: String(body.country || 'SG').toUpperCase(),
      hourUtc: Number.isInteger(body.hourUtc) ? body.hourUtc : now.getUTCHours(),
      status: TRANSACTION_STATUS.PENDING,
      fraudScore: null,
      outcomeReason: null,
      idempotencyKey: context.idempotencyKey,
      correlationId: context.correlationId,
      requestId: context.requestId
    });

    const eventPayload = {
      eventType: 'transaction.created',
      event_type: 'transaction.created.v1',
      trace_id: record.transaction_id,
      correlationId: context.correlationId,
      transactionId: record.transaction_id,
      customerId: record.customer_id,
      merchantId: record.merchant_id,
      transaction: toFraudTransaction(record),
      data: {
        transaction_id: record.transaction_id,
        amount: record.amount,
        currency: record.currency,
        card_type: record.card_type,
        country: record.country,
        merchant_id: record.merchant_id,
        hour_utc: record.hour_utc,
        customer_id: record.customer_id,
        sender_name: record.sender_name,
        recipient_customer_id: record.recipient_customer_id,
        recipient_name: record.recipient_name
      },
      createdAt: record.created_at
    };

    await publish(
      config.kafka.topics.transactionCreated,
      record.customer_id,
      eventPayload,
      { 'x-correlation-id': context.correlationId }
    );

    return record;
  }

  async listByCustomer(customerId, direction) {
    return transactionRepository.listByCustomer(customerId, direction || 'all');
  }

  async getById(transactionId) {
    const record = await transactionRepository.findById(transactionId);
    if (!record) {
      throw new NotFoundError('transaction not found');
    }
    return record;
  }

  async getDecision(transactionId) {
    const record = await this.getById(transactionId);
    return {
      transaction_id: record.transaction_id,
      status: record.status,
      fraud_score: record.fraud_score,
      outcome_reason: record.outcome_reason,
      updated_at: record.updated_at
    };
  }
}

module.exports = new TransactionService();

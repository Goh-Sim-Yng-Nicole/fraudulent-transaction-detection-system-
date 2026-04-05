'use strict';

const config = require('../config');
const logger = require('../config/logger');
const { createConsumer } = require('../config/kafka');
const { getPool } = require('../db/pool');

let consumer = null;

const upsertTransaction = async (pool, data, payload) => {
  const transactionId = data.transactionId || data.transaction_id || data.id;
  const customerId = data.customerId || data.customer_id;
  // data.outcome covers transaction.finalised (APPROVED/REJECTED)
  // payload.decision covers transaction.flagged (FLAGGED) and transaction.finalised
  const status =
    data.status ||
    data.queueStatus ||
    data.outcome ||
    (payload && (payload.decision || payload.status)) ||
    'UNKNOWN';
  if (!transactionId || !customerId) return;

  await pool.query(
    `INSERT INTO transactions_cache (transaction_id, customer_id, status, amount, currency, correlation_id, raw, cached_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (transaction_id) DO UPDATE
       SET status         = EXCLUDED.status,
           amount         = EXCLUDED.amount,
           currency       = EXCLUDED.currency,
           correlation_id = EXCLUDED.correlation_id,
           raw            = EXCLUDED.raw,
           cached_at      = NOW()`,
    [
      transactionId,
      customerId,
      status,
      data.amount ?? null,
      data.currency ?? null,
      data.correlationId || data.correlation_id || null,
      JSON.stringify(data),
    ],
  );
};

const start = async () => {
  const pool = getPool();
  consumer = await createConsumer(config.kafka.txnCacheGroupId);

  const topics = [
    config.kafka.inputTopicTxnCreated,
    config.kafka.inputTopicTxnFlagged,
    config.kafka.inputTopicTxnFinalised,
  ];

  await consumer.subscribe({ topics, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const raw = message.value?.toString();
        if (!raw) return;
        const payload = JSON.parse(raw);
        const data = payload.data || payload;
        await upsertTransaction(pool, data, payload);
        logger.debug('Transaction cache updated', {
          topic,
          transactionId: data.transactionId || data.transaction_id,
        });
      } catch (err) {
        logger.error('Error processing transaction cache event', {
          topic,
          partition,
          error: err.message,
        });
      } finally {
        await consumer.commitOffsets([
          { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
        ]);
      }
    },
  });

  logger.info('Transaction cache consumer started', { topics });
};

const stop = async () => {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
};

module.exports = { start, stop };

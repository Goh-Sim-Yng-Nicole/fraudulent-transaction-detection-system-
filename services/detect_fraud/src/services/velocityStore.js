const redis = require('redis');
const config = require('../config');
const logger = require('../config/logger');

let client = null;
const memoryWindow = new Map();

const prune = (customerId, now) => {
  const current = memoryWindow.get(customerId) || [];
  const oneHourAgo = now - 60 * 60 * 1000;
  const kept = current.filter((entry) => entry.timestamp >= oneHourAgo);
  memoryWindow.set(customerId, kept);
  return kept;
};

const getClient = async () => {
  if (config.redis.disabled || !config.redis.host) {
    return null;
  }

  if (client) {
    return client;
  }

  client = redis.createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port
    },
    password: config.redis.password,
    database: config.redis.db
  });

  client.on('error', (error) => {
    logger.warn('Fraud detection Redis error; using in-memory velocity fallback', {
      error: error.message
    });
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    logger.warn('Failed to connect fraud detection Redis; using in-memory fallback', {
      error: error.message
    });
    client = null;
    return null;
  }
};

class VelocityStore {
  async record(customerId, amount, now = Date.now()) {
    const redisClient = await getClient();
    if (!redisClient) {
      const entries = prune(customerId, now);
      entries.push({ timestamp: now, amount });
      memoryWindow.set(customerId, entries);
      return {
        countLastHour: entries.length,
        amountLastHour: entries.reduce((sum, entry) => sum + entry.amount, 0)
      };
    }

    const key = `fraud:velocity:${customerId}`;
    const amountKey = `fraud:velocity:amount:${customerId}`;
    const oneHourAgo = now - 60 * 60 * 1000;

    await redisClient.zRemRangeByScore(key, 0, oneHourAgo);
    await redisClient.zAdd(key, [{ score: now, value: `${now}:${Math.random()}` }]);
    await redisClient.expire(key, 3600);

    const currentAmount = Number(await redisClient.get(amountKey) || 0);
    const nextAmount = currentAmount + amount;
    await redisClient.set(amountKey, String(nextAmount), { EX: 3600 });

    return {
      countLastHour: await redisClient.zCard(key),
      amountLastHour: nextAmount
    };
  }
}

module.exports = new VelocityStore();

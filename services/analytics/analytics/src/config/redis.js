const redis = require('redis');
const config = require('./index');
const logger = require('./logger');

let client = null;
let isConnecting = false;
let memoryClient = null;

const createMemoryClient = () => {
  if (memoryClient) return memoryClient;

  const kv = new Map();
  const sets = new Map();
  const ensureSet = (key) => {
    if (!sets.has(key)) {
      sets.set(key, new Set());
    }
    return sets.get(key);
  };

  memoryClient = {
    mode: 'memory',
    isReady: true,
    async ping() {
      return 'PONG';
    },
    async sAdd(key, value) {
      ensureSet(key).add(String(value));
      return 1;
    },
    async set(key, value) {
      kv.set(String(key), String(value));
      return 'OK';
    },
    async get(key) {
      return kv.has(String(key)) ? kv.get(String(key)) : null;
    },
    async sMembers(key) {
      return Array.from(ensureSet(key));
    },
    async sCard(key) {
      return ensureSet(key).size;
    },
    multi() {
      const operations = [];
      return {
        sAdd(key, value) {
          operations.push(() => memoryClient.sAdd(key, value));
          return this;
        },
        set(key, value) {
          operations.push(() => memoryClient.set(key, value));
          return this;
        },
        get(key) {
          operations.push(() => memoryClient.get(key));
          return this;
        },
        async exec() {
          const results = [];
          for (const operation of operations) {
            results.push(await operation());
          }
          return results;
        },
      };
    },
    async quit() {},
  };

  return memoryClient;
};

// Handles create client.
const createClient = async () => {
  if (config.redis.disabled) {
    logger.warn('Redis disabled for analytics service; using in-memory projection store');
    client = createMemoryClient();
    return client;
  }
  if (client?.isReady) return client;
  if (isConnecting) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return client;
  }

  isConnecting = true;

  const redisConfig = {
    socket: {
      host: config.redis.host,
      port: config.redis.port,
      connectTimeout: config.redis.connectTimeout,
      reconnectStrategy: (retries) => {
        if (retries > 5) {
          logger.error('Redis max reconnection attempts reached', { retries });
          return new Error('Max reconnection attempts reached');
        }
        const delay = Math.min(500 * Math.pow(2, retries), 10000);
        logger.warn('Redis reconnecting', { attempt: retries + 1, delayMs: delay });
        return delay;
      },
    },
    ...(config.redis.password && { password: config.redis.password }),
    database: config.redis.db,
  };

  client = redis.createClient(redisConfig);
  client.mode = 'redis';

  client.on('error', (err) => {
    logger.error('Redis client error', { error: err.message, code: err.code });
  });

  client.on('connect', () => {
    logger.info('Redis connecting...');
  });

  client.on('ready', () => {
    isConnecting = false;
    logger.info('Redis ready', {
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
    });
  });

  client.on('end', () => {
    logger.warn('Redis connection ended');
  });

  try {
    await client.connect();
  } catch (err) {
    isConnecting = false;
    logger.warn('Redis initial connection failed; falling back to in-memory projection store', {
      error: err.message,
    });
    client = createMemoryClient();
  }

  return client;
};

// Handles get client.
const getClient = () => {
  if (!client) {
    throw new Error('Redis client not initialized or not ready');
  }
  return client;
};

// Handles close client.
const closeClient = async () => {
  if (client) {
    try {
      if (client !== memoryClient) {
        await client.quit();
        logger.info('Redis connection closed gracefully');
      }
    } catch (err) {
      logger.error('Error closing Redis connection', { error: err.message });
      if (typeof client.disconnect === 'function') {
        client.disconnect();
      }
    } finally {
      client = null;
      isConnecting = false;
    }
  }
};

module.exports = { createClient, getClient, closeClient };

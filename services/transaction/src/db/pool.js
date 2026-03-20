const { Pool } = require('pg');
const config = require('../config');
const logger = require('../config/logger');

let pool = null;

const createPool = () => {
  if (pool) return pool;

  pool = new Pool(
    config.db.connectionString
      ? {
          connectionString: config.db.connectionString,
          max: config.db.max,
          idleTimeoutMillis: config.db.idleTimeoutMillis,
          connectionTimeoutMillis: config.db.connectionTimeoutMillis
        }
      : {
          host: config.db.host,
          port: config.db.port,
          database: config.db.database,
          user: config.db.user,
          password: config.db.password,
          max: config.db.max,
          idleTimeoutMillis: config.db.idleTimeoutMillis,
          connectionTimeoutMillis: config.db.connectionTimeoutMillis
        }
  );

  pool.on('error', (error) => {
    logger.error('Database pool error', { error: error.message });
  });

  return pool;
};

const getPool = () => {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  return pool;
};

const query = async (text, params = []) => {
  return getPool().query(text, params);
};

const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = {
  createPool,
  getPool,
  query,
  closePool
};

const { Pool } = require('pg');
const config = require('../config');
const logger = require('../config/logger');

let pool = null;

// Handles create pool.
const createPool = () => {
  if (pool) return pool;

  pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: config.db.max,
    idleTimeoutMillis: config.db.idleTimeoutMillis,
    connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  });

  pool.on('error', (err) => {
    logger.error('PostgreSQL pool error', { error: err.message });
  });

  pool.on('connect', () => {
    logger.debug('New PostgreSQL client connected');
  });

  logger.info('PostgreSQL pool created');
  return pool;
};

// Handles query.
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { duration, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.error('Query failed', { error: err.message, query: text });
    throw err;
  }
};

// Handles get client.
const getClient = async () => {
  return pool.connect();
};

// Handles close pool.
const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('DB pool closed');
  }
};

module.exports = { createPool, query, getClient, closePool };
const { Pool } = require('pg');
const config = require('../config');

let pool = null;

const createPool = () => {
  if (pool) return pool;
  pool = new Pool(config.db);
  return pool;
};

const getPool = () => {
  if (!pool) return createPool();
  return pool;
};

const query = (text, params) => getPool().query(text, params);

const closePool = async () => {
  if (!pool) return;
  await pool.end();
  pool = null;
};

module.exports = { createPool, getPool, query, closePool };

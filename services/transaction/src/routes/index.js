const express = require('express');
const healthRoutes = require('./health');
const transactionRoutes = require('./transactions');

const router = express.Router();

router.use(healthRoutes);
router.use(transactionRoutes);

module.exports = router;

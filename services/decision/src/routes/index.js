const express = require('express');
const healthRoutes = require('./health');
const metricsRoutes = require('./metrics');
const decisionRoutes = require('./decisions');

const router = express.Router();

router.use(healthRoutes);
router.use(metricsRoutes);
router.use(decisionRoutes);

module.exports = router;
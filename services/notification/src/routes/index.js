const express = require('express');
const healthRoutes = require('./health');
const metricsRoutes = require('./metrics');

const router = express.Router();

router.use(healthRoutes);
router.use(metricsRoutes);

module.exports = router;
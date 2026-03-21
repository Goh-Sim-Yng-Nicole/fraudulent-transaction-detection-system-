const express = require('express');
const healthRoutes = require('./health');
const analyticsRoutes = require('./analytics');
const legacyAnalyticsRoutes = require('./legacyAnalytics');

const router = express.Router();

router.use(healthRoutes);
router.use(analyticsRoutes);
router.use(legacyAnalyticsRoutes);

module.exports = router;

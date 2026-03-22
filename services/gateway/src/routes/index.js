const express = require('express');
const healthRoutes = require('./health');
const staffAuthRoutes = require('./staffAuth');
const legacyProxyRoutes = require('./legacyProxy');
const proxyRoutes = require('./proxy');

const router = express.Router();

router.use(healthRoutes);
router.use(staffAuthRoutes);
router.use(legacyProxyRoutes);
router.use(proxyRoutes);

module.exports = router;

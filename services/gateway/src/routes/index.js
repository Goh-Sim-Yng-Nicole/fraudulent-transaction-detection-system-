const express = require('express');
const healthRoutes = require('./health');
const legacyProxyRoutes = require('./legacyProxy');
const proxyRoutes = require('./proxy');

const router = express.Router();

router.use(healthRoutes);
router.use(legacyProxyRoutes);
router.use(proxyRoutes);

module.exports = router;

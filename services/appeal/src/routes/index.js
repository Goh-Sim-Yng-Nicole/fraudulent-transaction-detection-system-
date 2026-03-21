const express = require('express');
const healthRoutes = require('./health');
const appealRoutes = require('./appeals');

const router = express.Router();

router.use(healthRoutes);
router.use(appealRoutes);

module.exports = router;

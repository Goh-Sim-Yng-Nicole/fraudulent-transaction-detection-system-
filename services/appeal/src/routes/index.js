const express = require('express');
const healthRoutes = require('./health');
const appealRoutes = require('./appeals');
const legacyAppealRoutes = require('./legacyAppeals');

const router = express.Router();

router.use(healthRoutes);
router.use(legacyAppealRoutes);
router.use(appealRoutes);

module.exports = router;

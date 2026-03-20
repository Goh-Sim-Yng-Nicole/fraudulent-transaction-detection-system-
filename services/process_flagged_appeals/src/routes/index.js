const express = require('express');
const healthRoutes = require('./health');
const legacyReviewRoutes = require('./legacyReviews');
const reviewRoutes = require('./reviews');

const router = express.Router();

router.use(healthRoutes);
router.use(legacyReviewRoutes);
router.use(reviewRoutes);

module.exports = router;

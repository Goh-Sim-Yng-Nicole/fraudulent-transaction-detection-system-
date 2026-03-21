const projectionStore = require('./projectionStore');

class AnalyticsService {
  // Handles get dashboard metrics.
  async getDashboardMetrics(timeRange = '24h') {
    const now = new Date();
    const since = this._getTimeRangeDate(timeRange);
    const [allTransactions, allAppeals] = await Promise.all([
      projectionStore.listTransactions(),
      projectionStore.listAppeals(),
    ]);
    const transactions = allTransactions.filter((record) => this._isOnOrAfter(record.decidedAt, since));

    const [
      overviewStats,
      decisionBreakdown,
      riskScoreDistribution,
      timeSeriesData,
      topCustomers,
      topMerchants,
      geographicDistribution,
      analystImpact,
      appealImpact,
    ] = await Promise.all([
      this._getOverviewStats(transactions),
      this._getDecisionBreakdown(transactions),
      this._getRiskScoreDistribution(transactions),
      this._getTimeSeriesData(transactions, timeRange),
      this._getTopCustomers(transactions, 10),
      this._getTopMerchants(transactions, 10),
      this._getGeographicDistribution(transactions),
      this._getAnalystImpactStats(transactions),
      this._getAppealImpactStats(allAppeals, since),
    ]);

    return {
      overview: overviewStats,
      decisions: decisionBreakdown,
      riskScores: riskScoreDistribution,
      timeSeries: timeSeriesData,
      topCustomers,
      topMerchants,
      geography: geographicDistribution,
      analystImpact,
      appealImpact,
      metadata: {
        timeRange,
        since: since.toISOString(),
        generatedAt: now.toISOString(),
      },
    };
  }

  // Handles get real time stats.
  async getRealTimeStats() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const transactions = await projectionStore.listTransactions();
    const recentTransactions = transactions.filter((record) => this._isOnOrAfter(record.decidedAt, fiveMinutesAgo));
    const approved = recentTransactions.filter((record) => record.decision === 'APPROVED');
    const declined = recentTransactions.filter((record) => record.decision === 'DECLINED');
    const flagged = recentTransactions.filter((record) => record.decision === 'FLAGGED');
    const scores = recentTransactions.map((record) => this._safeNumber(record.riskScore)).filter(Number.isFinite);

    return {
      totalDecisions: recentTransactions.length,
      approved: approved.length,
      declined: declined.length,
      flagged: flagged.length,
      avgRiskScore: this._average(scores, 1),
      maxRiskScore: scores.length ? Math.max(...scores) : 0,
      overrides: recentTransactions.filter((record) => record.overrideApplied).length,
      timestamp: new Date().toISOString(),
    };
  }

  // Handles get overview stats.
  async _getOverviewStats(transactions) {
    const total = transactions.length;
    const approved = transactions.filter((record) => record.decision === 'APPROVED').length;
    const declined = transactions.filter((record) => record.decision === 'DECLINED').length;
    const flagged = transactions.filter((record) => record.decision === 'FLAGGED').length;
    const riskScores = transactions.map((record) => this._safeNumber(record.riskScore)).filter(Number.isFinite);
    const mlScores = transactions.map((record) => this._safeNumber(record.mlScore)).filter(Number.isFinite);
    const ruleScores = transactions.map((record) => this._safeNumber(record.ruleScore)).filter(Number.isFinite);
    const uniqueCustomers = new Set(transactions.map((record) => record.customerId).filter(Boolean));
    const uniqueMerchants = new Set(transactions.map((record) => record.merchantId).filter(Boolean));

    return {
      totalTransactions: total,
      approved,
      declined,
      flagged,
      approvalRate: total > 0 ? Number(((approved / total) * 100).toFixed(1)) : 0,
      declineRate: total > 0 ? Number(((declined / total) * 100).toFixed(1)) : 0,
      flagRate: total > 0 ? Number(((flagged / total) * 100).toFixed(1)) : 0,
      avgRiskScore: this._average(riskScores, 1),
      avgMlScore: this._average(mlScores, 1),
      avgRuleScore: this._average(ruleScores, 1),
      fraudFlaggedCount: transactions.filter((record) => record.fraudFlagged).length,
      overrideCount: transactions.filter((record) => record.overrideApplied).length,
      uniqueCustomers: uniqueCustomers.size,
      uniqueMerchants: uniqueMerchants.size,
    };
  }

  // Handles get decision breakdown.
  async _getDecisionBreakdown(transactions) {
    return ['APPROVED', 'DECLINED', 'FLAGGED'].map((decision) => {
      const filtered = transactions.filter((record) => record.decision === decision);
      const scores = filtered.map((record) => this._safeNumber(record.riskScore)).filter(Number.isFinite);
      return {
        decision,
        count: filtered.length,
        avgRiskScore: this._average(scores, 1),
        minRiskScore: scores.length ? Math.min(...scores) : 0,
        maxRiskScore: scores.length ? Math.max(...scores) : 0,
      };
    });
  }

  // Handles get risk score distribution.
  async _getRiskScoreDistribution(transactions) {
    const buckets = [
      { range: '0-19', min: 0, maxExclusive: 20, approved: 0, declined: 0, flagged: 0, total: 0 },
      { range: '20-39', min: 20, maxExclusive: 40, approved: 0, declined: 0, flagged: 0, total: 0 },
      { range: '40-59', min: 40, maxExclusive: 60, approved: 0, declined: 0, flagged: 0, total: 0 },
      { range: '60-79', min: 60, maxExclusive: 80, approved: 0, declined: 0, flagged: 0, total: 0 },
      { range: '80-100', min: 80, maxExclusive: Infinity, approved: 0, declined: 0, flagged: 0, total: 0 },
    ];

    transactions.forEach((record) => {
      const riskScore = this._safeNumber(record.riskScore);
      const bucket = buckets.find((candidate) => riskScore >= candidate.min && riskScore < candidate.maxExclusive);
      if (!bucket) {
        return;
      }

      const key = String(record.decision || '').toLowerCase();
      if (key && Object.prototype.hasOwnProperty.call(bucket, key)) {
        bucket[key] += 1;
      }
      bucket.total += 1;
    });

    return buckets.map(({ range, approved, declined, flagged, total }) => ({
      range,
      approved,
      declined,
      flagged,
      total,
    }));
  }

  // Handles get time series data.
  async _getTimeSeriesData(transactions, timeRange) {
    const bucketMs = timeRange === '1h' ? 5 * 60 * 1000
      : timeRange === '24h' ? 60 * 60 * 1000
        : timeRange === '7d' ? 6 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

    const buckets = new Map();

    transactions.forEach((record) => {
      const decidedAt = this._asDate(record.decidedAt);
      if (!decidedAt) {
        return;
      }

      const bucketTime = new Date(Math.floor(decidedAt.getTime() / bucketMs) * bucketMs).toISOString();
      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, {
          timestamp: bucketTime,
          approved: 0,
          declined: 0,
          flagged: 0,
          total: 0,
          riskScores: [],
        });
      }

      const bucket = buckets.get(bucketTime);
      const key = String(record.decision || '').toLowerCase();
      if (key && Object.prototype.hasOwnProperty.call(bucket, key)) {
        bucket[key] += 1;
      }
      bucket.total += 1;
      bucket.riskScores.push(this._safeNumber(record.riskScore));
    });

    return Array.from(buckets.values())
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .map((bucket) => ({
        timestamp: bucket.timestamp,
        approved: bucket.approved,
        declined: bucket.declined,
        flagged: bucket.flagged,
        total: bucket.total,
        avgRiskScore: this._average(bucket.riskScores.filter(Number.isFinite), 1),
      }));
  }

  // Handles get top customers.
  async _getTopCustomers(transactions, limit) {
    const customers = new Map();

    transactions.forEach((record) => {
      if (!record.customerId) {
        return;
      }

      const current = customers.get(record.customerId) || {
        customerId: record.customerId,
        transactionCount: 0,
        declinedCount: 0,
        flaggedCount: 0,
        riskScores: [],
      };

      current.transactionCount += 1;
      if (record.decision === 'DECLINED') {
        current.declinedCount += 1;
      }
      if (record.decision === 'FLAGGED') {
        current.flaggedCount += 1;
      }
      current.riskScores.push(this._safeNumber(record.riskScore));
      customers.set(record.customerId, current);
    });

    return Array.from(customers.values())
      .sort((left, right) => right.transactionCount - left.transactionCount || right.flaggedCount - left.flaggedCount)
      .slice(0, limit)
      .map((record) => ({
        customerId: record.customerId,
        transactionCount: record.transactionCount,
        declinedCount: record.declinedCount,
        flaggedCount: record.flaggedCount,
        avgRiskScore: this._average(record.riskScores.filter(Number.isFinite), 1),
      }));
  }

  // Handles get top merchants.
  async _getTopMerchants(transactions, limit) {
    const merchants = new Map();

    transactions.forEach((record) => {
      if (!record.merchantId) {
        return;
      }

      const current = merchants.get(record.merchantId) || {
        merchantId: record.merchantId,
        transactionCount: 0,
        declinedCount: 0,
        riskScores: [],
      };

      current.transactionCount += 1;
      if (record.decision === 'DECLINED') {
        current.declinedCount += 1;
      }
      current.riskScores.push(this._safeNumber(record.riskScore));
      merchants.set(record.merchantId, current);
    });

    return Array.from(merchants.values())
      .sort((left, right) => right.transactionCount - left.transactionCount || right.declinedCount - left.declinedCount)
      .slice(0, limit)
      .map((record) => ({
        merchantId: record.merchantId,
        transactionCount: record.transactionCount,
        declinedCount: record.declinedCount,
        avgRiskScore: this._average(record.riskScores.filter(Number.isFinite), 1),
      }));
  }

  // Handles get geographic distribution.
  async _getGeographicDistribution(transactions) {
    const countries = new Map();

    transactions.forEach((record) => {
      const country = record.country || 'Unknown';
      const current = countries.get(country) || {
        country,
        count: 0,
        declined: 0,
      };

      current.count += 1;
      if (record.decision === 'DECLINED') {
        current.declined += 1;
      }
      countries.set(country, current);
    });

    return Array.from(countries.values())
      .sort((left, right) => right.count - left.count)
      .slice(0, 10);
  }

  // Handles get analyst impact stats.
  async _getAnalystImpactStats(transactions) {
    const manualReviews = transactions.filter((record) => record.manualReview?.applied);
    const approvedAfterReview = manualReviews.filter((record) => record.manualReview?.reviewDecision === 'APPROVED').length;
    const declinedAfterReview = manualReviews.filter((record) => record.manualReview?.reviewDecision === 'DECLINED').length;
    const turnaroundSeconds = manualReviews
      .map((record) => this._calculateTurnaroundSeconds(record.flaggedAt, record.manualReview?.reviewedAt))
      .filter((value) => value !== null);
    const totalManualReviews = manualReviews.length;
    const avgTurnaroundSeconds = this._average(turnaroundSeconds, 1);

    return {
      totalManualReviews,
      approvedAfterReview,
      declinedAfterReview,
      approvedAfterReviewRate: totalManualReviews > 0
        ? Number(((approvedAfterReview / totalManualReviews) * 100).toFixed(1))
        : 0,
      declinedAfterReviewRate: totalManualReviews > 0
        ? Number(((declinedAfterReview / totalManualReviews) * 100).toFixed(1))
        : 0,
      avgReviewTurnaroundSeconds: avgTurnaroundSeconds,
      avgReviewTurnaroundMinutes: Number((avgTurnaroundSeconds / 60).toFixed(2)),
    };
  }

  // Handles get appeal impact stats.
  async _getAppealImpactStats(appeals, since) {
    const appealsCreated = appeals.filter((record) => this._isOnOrAfter(record.createdAt, since));
    const appealsPending = appeals.filter((record) => ['OPEN', 'UNDER_REVIEW'].includes(String(record.currentStatus || '').toUpperCase()));
    const appealsResolved = appeals.filter((record) => String(record.currentStatus || '').toUpperCase() === 'RESOLVED' && this._isOnOrAfter(record.resolvedAt, since));
    const upheldCount = appealsResolved.filter((record) => String(record.resolution || record.outcome || '').toUpperCase() === 'UPHOLD').length;
    const reversedCount = appealsResolved.filter((record) => String(record.resolution || record.outcome || '').toUpperCase() === 'REVERSE').length;

    return {
      appealsCreated: appealsCreated.length,
      appealsPending: appealsPending.length,
      appealsResolved: appealsResolved.length,
      upheldCount,
      reversedCount,
      uniqueTransactionsAppealed: new Set(appealsCreated.map((record) => record.transactionId).filter(Boolean)).size,
      reverseRate: appealsResolved.length > 0 ? Number(((reversedCount / appealsResolved.length) * 100).toFixed(1)) : 0,
      upholdRate: appealsResolved.length > 0 ? Number(((upheldCount / appealsResolved.length) * 100).toFixed(1)) : 0,
    };
  }

  // Handles get time range date.
  _getTimeRangeDate(timeRange) {
    const now = new Date();
    switch (timeRange) {
      case '1h':
        return new Date(now.getTime() - 1 * 60 * 60 * 1000);
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  _isOnOrAfter(value, since) {
    const date = this._asDate(value);
    return Boolean(date && date >= since);
  }

  _asDate(value) {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  _safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  _average(values, decimals = 0) {
    if (!values.length) {
      return 0;
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    return Number((total / values.length).toFixed(decimals));
  }

  _calculateTurnaroundSeconds(fromValue, toValue) {
    const from = this._asDate(fromValue);
    const to = this._asDate(toValue);
    if (!from || !to) {
      return null;
    }

    const diffSeconds = (to.getTime() - from.getTime()) / 1000;
    return diffSeconds >= 0 ? diffSeconds : null;
  }
}

module.exports = new AnalyticsService();

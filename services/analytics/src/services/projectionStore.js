const config = require('../config');
const { getClient } = require('../config/redis');
const logger = require('../config/logger');

class ProjectionStore {
  constructor() {
    this.keyPrefix = config.analytics.projectionPrefix;
    this.transactionIndexKey = `${this.keyPrefix}:transactions`;
    this.appealIndexKey = `${this.keyPrefix}:appeals`;
  }

  async upsertDecisionEvent(event) {
    if (!event?.transactionId) {
      throw new Error('transactionId is required for analytics projection');
    }

    const existing = await this.getTransactionById(event.transactionId);
    const originalTransaction = event.originalTransaction || existing?.originalTransaction || {};
    const fraudAnalysis = event.fraudAnalysis || existing?.fraudAnalysis || {};
    const decidedAt = this._normalizeTimestamp(event.decidedAt || event.processedAt || existing?.decidedAt);
    const stateUpdatedAt = decidedAt || this._normalizeTimestamp(existing?.stateUpdatedAt) || new Date().toISOString();
    const currentStateAt = this._asDate(existing?.stateUpdatedAt || existing?.decidedAt);
    const incomingStateAt = this._asDate(stateUpdatedAt);
    const shouldApplyState = !currentStateAt || !incomingStateAt || incomingStateAt >= currentStateAt;

    const flaggedAt = this._normalizeTimestamp(this._earliestDate(
      this._asDate(existing?.flaggedAt),
      event.decision === 'FLAGGED' ? this._asDate(stateUpdatedAt) : null
    ));

    const record = {
      transactionId: event.transactionId,
      customerId: event.customerId || originalTransaction.customerId || existing?.customerId || null,
      merchantId: event.merchantId || originalTransaction.merchantId || existing?.merchantId || null,
      amount: this._toNumber(originalTransaction.amount, existing?.amount),
      currency: originalTransaction.currency || existing?.currency || 'USD',
      country: originalTransaction.location?.country || existing?.country || 'Unknown',
      city: originalTransaction.location?.city || existing?.city || null,
      originalTransaction,
      fraudAnalysis,
      riskScore: this._toNumber(fraudAnalysis.riskScore, existing?.riskScore),
      mlScore: this._toNumber(fraudAnalysis.mlResults?.score, existing?.mlScore),
      ruleScore: this._toNumber(fraudAnalysis.ruleResults?.ruleScore, existing?.ruleScore),
      fraudFlagged: this._toBoolean(fraudAnalysis.flagged, existing?.fraudFlagged),
      confidence: this._toNumber(fraudAnalysis.mlResults?.confidence, existing?.confidence),
      decision: shouldApplyState ? (event.decision || existing?.decision || null) : (existing?.decision || null),
      decisionReason: shouldApplyState ? (event.decisionReason || existing?.decisionReason || null) : (existing?.decisionReason || null),
      decisionFactors: {
        ...(existing?.decisionFactors || {}),
        ...(event.decisionFactors || {}),
      },
      decidedAt: shouldApplyState ? stateUpdatedAt : (existing?.decidedAt || null),
      stateUpdatedAt: shouldApplyState ? stateUpdatedAt : (existing?.stateUpdatedAt || existing?.decidedAt || null),
      flaggedAt,
      overrideApplied: Boolean(existing?.overrideApplied),
      overrideType: existing?.overrideType || null,
      manualReview: existing?.manualReview || null,
      correlationId: event.correlationId || existing?.correlationId || null,
      lastSourceEvent: event.eventType || existing?.lastSourceEvent || null,
      createdAt: existing?.createdAt || stateUpdatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };

    await this._saveTransaction(record);
    return record;
  }

  async applyManualReview(event) {
    if (!event?.transactionId) {
      throw new Error('transactionId is required for manual review projection');
    }

    const existing = await this.getTransactionById(event.transactionId);
    const reviewedAt = this._normalizeTimestamp(event.reviewedAt || new Date().toISOString());
    const previousDecision = event.previousDecision || existing?.decision || 'FLAGGED';
    const reviewDecision = event.reviewDecision || event.decision;

    if (!reviewDecision) {
      throw new Error('reviewDecision is required for manual review projection');
    }

    const manualReview = {
      applied: true,
      previousDecision,
      reviewDecision,
      reviewedBy: event.reviewedBy || null,
      reviewNotes: event.reviewNotes || event.notes || null,
      reviewedAt,
    };

    const record = {
      ...(existing || {}),
      transactionId: event.transactionId,
      customerId: event.customerId || existing?.customerId || null,
      merchantId: event.merchantId || existing?.merchantId || null,
      decision: reviewDecision,
      decisionReason: `Manual review final decision: ${reviewDecision}`,
      decisionFactors: {
        ...(existing?.decisionFactors || {}),
        manualReviewApplied: true,
        manualReview: {
          reviewedBy: manualReview.reviewedBy,
          reviewNotes: manualReview.reviewNotes,
          reviewedAt,
          sourceEventType: 'transaction.reviewed',
        },
      },
      decidedAt: reviewedAt,
      stateUpdatedAt: reviewedAt,
      flaggedAt: existing?.flaggedAt || (previousDecision === 'FLAGGED' ? (existing?.decidedAt || reviewedAt) : null),
      overrideApplied: true,
      overrideType: 'MANUAL_REVIEW',
      manualReview,
      correlationId: event.correlationId || existing?.correlationId || null,
      lastSourceEvent: event.eventType || 'transaction.reviewed',
      createdAt: existing?.createdAt || reviewedAt,
      updatedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };

    await this._saveTransaction(record);
    return record;
  }

  async upsertAppealCreated(event) {
    if (!event?.appealId) {
      throw new Error('appealId is required for analytics projection');
    }

    const existing = await this.getAppealById(event.appealId);
    const createdAt = this._normalizeTimestamp(event.createdAt || existing?.createdAt || new Date().toISOString());

    const record = {
      ...(existing || {}),
      appealId: event.appealId,
      transactionId: event.transactionId || existing?.transactionId || null,
      customerId: event.customerId || existing?.customerId || null,
      sourceTransactionStatus: event.sourceTransactionStatus || existing?.sourceTransactionStatus || null,
      appealReason: event.appealReason || existing?.appealReason || null,
      evidence: event.evidence || existing?.evidence || {},
      currentStatus: existing?.currentStatus === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
      createdAt,
      resolvedAt: existing?.resolvedAt || null,
      resolution: existing?.resolution || null,
      outcome: existing?.outcome || null,
      reviewedBy: existing?.reviewedBy || null,
      resolutionNotes: existing?.resolutionNotes || null,
      correlationId: event.correlationId || existing?.correlationId || null,
      lastSourceEvent: event.eventType || existing?.lastSourceEvent || null,
      updatedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };

    await this._saveAppeal(record);
    return record;
  }

  async upsertAppealResolved(event) {
    if (!event?.appealId) {
      throw new Error('appealId is required for analytics projection');
    }

    const existing = await this.getAppealById(event.appealId);
    const resolvedAt = this._normalizeTimestamp(event.resolvedAt || new Date().toISOString());
    const resolution = event.resolution || event.outcome || existing?.resolution || null;

    const record = {
      ...(existing || {}),
      appealId: event.appealId,
      transactionId: event.transactionId || existing?.transactionId || null,
      customerId: event.customerId || existing?.customerId || null,
      sourceTransactionStatus: event.sourceTransactionStatus || existing?.sourceTransactionStatus || null,
      appealReason: existing?.appealReason || null,
      evidence: existing?.evidence || {},
      currentStatus: 'RESOLVED',
      createdAt: existing?.createdAt || resolvedAt,
      resolvedAt,
      resolution,
      outcome: event.outcome || event.resolution || existing?.outcome || null,
      reviewedBy: event.reviewedBy || existing?.reviewedBy || null,
      resolutionNotes: event.resolutionNotes || existing?.resolutionNotes || null,
      correlationId: event.correlationId || existing?.correlationId || null,
      lastSourceEvent: event.eventType || 'appeal.resolved',
      updatedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };

    await this._saveAppeal(record);

    if (record.transactionId) {
      await this._applyAppealResolutionToTransaction(record.transactionId, {
        resolution,
        resolvedAt,
        reviewedBy: record.reviewedBy,
        resolutionNotes: record.resolutionNotes,
        correlationId: record.correlationId,
        lastSourceEvent: record.lastSourceEvent,
      });
    }

    return record;
  }

  async listTransactions() {
    return this._getCollection(this.transactionIndexKey, (id) => this._transactionKey(id));
  }

  async listAppeals() {
    return this._getCollection(this.appealIndexKey, (id) => this._appealKey(id));
  }

  async getTransactionById(transactionId) {
    return this._getJson(this._transactionKey(transactionId));
  }

  async getAppealById(appealId) {
    return this._getJson(this._appealKey(appealId));
  }

  async getProjectionSummary() {
    const redis = getClient();
    const [transactions, appeals] = await Promise.all([
      redis.sCard(this.transactionIndexKey),
      redis.sCard(this.appealIndexKey),
    ]);

    return {
      transactionSnapshots: transactions,
      appealSnapshots: appeals,
      storage: redis.mode || 'redis',
      projectionPrefix: this.keyPrefix,
    };
  }

  _transactionKey(transactionId) {
    return `${this.keyPrefix}:transaction:${transactionId}`;
  }

  _appealKey(appealId) {
    return `${this.keyPrefix}:appeal:${appealId}`;
  }

  async _saveTransaction(record) {
    const redis = getClient();
    const key = this._transactionKey(record.transactionId);
    await redis.multi()
      .sAdd(this.transactionIndexKey, record.transactionId)
      .set(key, JSON.stringify(record))
      .exec();
  }

  async _saveAppeal(record) {
    const redis = getClient();
    const key = this._appealKey(record.appealId);
    await redis.multi()
      .sAdd(this.appealIndexKey, record.appealId)
      .set(key, JSON.stringify(record))
      .exec();
  }

  async _getCollection(indexKey, keyBuilder) {
    const redis = getClient();
    const ids = await redis.sMembers(indexKey);
    if (!ids.length) {
      return [];
    }

    const pipeline = redis.multi();
    ids.forEach((id) => pipeline.get(keyBuilder(id)));
    const values = await pipeline.exec();

    return values
      .map((value) => this._safeParse(value))
      .filter(Boolean);
  }

  async _getJson(key) {
    const redis = getClient();
    const value = await redis.get(key);
    return this._safeParse(value);
  }

  _safeParse(value) {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (err) {
      logger.warn('Skipping invalid analytics projection payload', {
        error: err.message,
      });
      return null;
    }
  }

  _normalizeTimestamp(value) {
    const asDate = this._asDate(value);
    return asDate ? asDate.toISOString() : null;
  }

  async _applyAppealResolutionToTransaction(transactionId, event) {
    const existing = await this.getTransactionById(transactionId);
    if (!existing) {
      return null;
    }

    const resolvedDecision = this._mapAppealResolutionToDecision(event.resolution);
    if (!resolvedDecision) {
      return existing;
    }

    const resolvedAt = this._normalizeTimestamp(event.resolvedAt || new Date().toISOString());
    const appealResolution = {
      resolution: event.resolution,
      resolvedDecision,
      reviewedBy: event.reviewedBy || null,
      resolutionNotes: event.resolutionNotes || null,
      resolvedAt,
    };

    const record = {
      ...existing,
      decision: resolvedDecision,
      decisionReason: `Appeal resolved: ${event.resolution}`,
      decisionFactors: {
        ...(existing.decisionFactors || {}),
        appealResolution,
      },
      decidedAt: resolvedAt,
      stateUpdatedAt: resolvedAt,
      overrideApplied: true,
      overrideType: resolvedDecision === 'APPROVED' ? 'APPEAL_REVERSED' : (existing.overrideType || 'MANUAL_REVIEW'),
      correlationId: event.correlationId || existing.correlationId || null,
      lastSourceEvent: event.lastSourceEvent || 'appeal.resolved',
      updatedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };

    await this._saveTransaction(record);
    return record;
  }

  _earliestDate(first, second) {
    if (!first) {
      return second || null;
    }
    if (!second) {
      return first;
    }
    return first <= second ? first : second;
  }

  _asDate(value) {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  _toNumber(value, fallback = 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    const fallbackNumber = Number(fallback);
    return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
  }

  _toBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
      return value;
    }
    return Boolean(fallback);
  }

  _mapAppealResolutionToDecision(resolution) {
    const normalized = String(resolution || '').toUpperCase();
    if (normalized === 'REVERSE') {
      return 'APPROVED';
    }
    if (normalized === 'UPHOLD') {
      return 'DECLINED';
    }
    return null;
  }
}

module.exports = new ProjectionStore();

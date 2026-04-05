import {
  html,
  useState,
  useEffect,
  useMemo,
  mountApp,
  fetchJson,
  nowTime,
  formatNumber,
} from './common.js';

const loginUrl = '/staff?redirect=/analyst';

const queueStatusClass = (status) => {
  const value = String(status || '').toLowerCase();
  if (value.includes('pending') || value.includes('open')) return 'status-pending';
  if (value.includes('review')) return 'status-flagged';
  if (value.includes('resolved') || value.includes('approved') || value.includes('reverse')) return 'status-approved';
  if (value.includes('declined') || value.includes('uphold')) return 'status-rejected';
  return '';
};

const manualDeclineThreshold = 76;

const uniqueStrings = (values) => [...new Set((values || []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];

const stopRowToggle = (event) => {
  event.stopPropagation();
};

const toggleExpanded = (prev, key) => ({
  ...prev,
  [key]: !prev[key],
});

const formatTimestamp = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

const formatFact = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
};

const compactEvidence = (evidence) => {
  if (!evidence) return [];
  if (typeof evidence === 'string') return [evidence];
  if (Array.isArray(evidence)) {
    return uniqueStrings(
      evidence.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
    );
  }
  if (typeof evidence === 'object') {
    return Object.entries(evidence).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return [String(evidence)];
};

const onExpandableKeyDown = (event, toggle) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggle();
  }
};

const extractReviewContext = (item) => {
  const transaction = item.originalTransaction || item.payload?.originalTransaction || {};
  const fraudAnalysis = item.fraudAnalysis || item.payload?.fraudAnalysis || {};
  const ruleResults = fraudAnalysis.ruleResults || {};
  const decisionFactors = item.decisionFactors || item.payload?.decisionFactors || {};
  const reasons = uniqueStrings([
    ...(item.reasonHighlights || []),
    ...(item.analysisReasons || []),
    ...(item.ruleReasons || []),
  ]);

  return {
    amount: transaction.amount ?? item.amount ?? null,
    currency: transaction.currency || item.currency || null,
    country: transaction.location?.country || item.transactionCountry || null,
    merchantId: transaction.merchantId || item.merchantId || null,
    cardType: transaction.cardType || item.cardType || null,
    createdAt: transaction.createdAt || item.transactionCreatedAt || null,
    adjustedScore: decisionFactors.adjustedScore ?? item.adjustedScore ?? item.riskScore ?? null,
    originalScore: decisionFactors.originalScore ?? item.originalScore ?? item.riskScore ?? null,
    mlScore: fraudAnalysis.mlResults?.score ?? item.mlScore ?? null,
    mlConfidence: fraudAnalysis.mlResults?.confidence ?? item.mlConfidence ?? null,
    modelVersion: fraudAnalysis.mlResults?.modelVersion || fraudAnalysis.mlResults?.model_version || item.modelVersion || null,
    decisionReason: item.decisionReason || item.payload?.decisionReason || 'Flagged for manual review',
    reasons,
    overrideReason: item.overrideReason || item.payload?.overrideReason || null,
    overrideType: item.overrideType || item.payload?.overrideType || null,
    ruleFlagged: Boolean(ruleResults.flagged),
  };
};

const extractAppealContext = (item) => {
  const summary = item.transactionSummary || {};
  const transaction = item.transaction || {};
  const decision = item.transactionDecision || {};

  return {
    amount: summary.amount ?? transaction.amount ?? null,
    currency: summary.currency ?? transaction.currency ?? null,
    country: summary.country ?? transaction.country ?? null,
    merchantId: summary.merchantId ?? transaction.merchant_id ?? null,
    cardType: summary.cardType ?? transaction.card_type ?? null,
    senderName: summary.senderName ?? transaction.sender_name ?? null,
    recipientCustomerId: summary.recipientCustomerId ?? transaction.recipient_customer_id ?? null,
    recipientName: summary.recipientName ?? transaction.recipient_name ?? null,
    transactionStatus: summary.transactionStatus ?? transaction.status ?? decision.status ?? item.sourceTransactionStatus ?? null,
    fraudScore: summary.fraudScore ?? decision.fraud_score ?? null,
    outcomeReason: summary.outcomeReason ?? decision.outcome_reason ?? null,
    createdAt: summary.createdAt ?? transaction.created_at ?? null,
    updatedAt: summary.updatedAt ?? transaction.updated_at ?? decision.updated_at ?? null,
    appealReason: item.appealReason || 'Customer dispute',
    evidence: compactEvidence(item.evidence),
  };
};

const renderFactList = (items) => {
  const normalized = items.filter(Boolean);
  if (!normalized.length) return null;
  return html`
    <div className="detail-list">
      ${normalized.map((item, index) => html`<div key=${`${index}-${item}`} className="small muted">${item}</div>`)}
    </div>
  `;
};

const renderReviewSummary = (facts) => html`
  <div style=${{ display: 'grid', gap: '0.35rem' }}>
    <div className="small" style=${{ color: '#d8e4ff', fontWeight: 600 }}>
      ${facts.decisionReason}
    </div>
    ${facts.reasons.length ? html`
      <div className="muted small">${facts.reasons.slice(0, 2).join(' | ')}</div>
    ` : html`
      <div className="muted small">Click to inspect the linked transaction context and score breakdown.</div>
    `}
  </div>
`;

const renderReviewExpanded = (facts) => {
  const scoreItems = [
    facts.originalScore !== null ? `Original score ${facts.originalScore}` : null,
    facts.adjustedScore !== null ? `Adjusted score ${facts.adjustedScore}` : null,
    facts.mlScore !== null ? `ML score ${facts.mlScore}` : null,
    facts.mlConfidence !== null ? `Model confidence ${formatNumber(Number(facts.mlConfidence) * 100)}%` : null,
    facts.modelVersion ? `Model version ${facts.modelVersion}` : null,
  ];

  return html`
    <div className="detail-panel">
      <div className="details-grid">
        <section className="detail-section">
          <div className="detail-label">Flag summary</div>
          <div className="detail-value">${facts.decisionReason}</div>
          ${renderFactList(facts.reasons)}
          ${facts.overrideReason ? html`
            <div className="small muted">
              Override applied: ${facts.overrideType || 'MANUAL_REVIEW'}${facts.overrideReason ? ` | ${facts.overrideReason}` : ''}
            </div>
          ` : null}
        </section>

        <section className="detail-section">
          <div className="detail-label">Transaction snapshot</div>
          <div className="row small muted">
            <span className="pill">${facts.currency || 'USD'} ${facts.amount !== null ? Number(facts.amount).toFixed(2) : '-'}</span>
            <span className="pill">Country ${formatFact(facts.country)}</span>
            <span className="pill">Merchant ${formatFact(facts.merchantId)}</span>
            <span className="pill">Card ${formatFact(facts.cardType)}</span>
          </div>
          <div className="small muted">Created ${formatTimestamp(facts.createdAt)}</div>
        </section>

        <section className="detail-section">
          <div className="detail-label">Score reasoning</div>
          ${renderFactList(scoreItems)}
          ${facts.adjustedScore !== null && facts.adjustedScore >= manualDeclineThreshold ? html`
            <div className="small" style=${{ color: '#ffcf8a' }}>
              Current policy auto-declines scores above 75. If this case is still here, it likely entered the queue before the threshold update.
            </div>
          ` : null}
        </section>
      </div>
    </div>
  `;
};

const renderAppealExpanded = (facts, item) => {
  const transactionFacts = [
    facts.amount !== null ? `${facts.currency || 'USD'} ${Number(facts.amount).toFixed(2)}` : null,
    facts.transactionStatus ? `Status ${facts.transactionStatus}` : null,
    facts.fraudScore !== null ? `Fraud score ${facts.fraudScore}` : null,
    facts.country ? `Country ${facts.country}` : null,
    facts.merchantId ? `Merchant ${facts.merchantId}` : null,
    facts.cardType ? `Card ${facts.cardType}` : null,
  ];

  const peopleFacts = [
    facts.senderName ? `Sender ${facts.senderName}` : null,
    facts.recipientName ? `Recipient ${facts.recipientName}` : null,
    facts.recipientCustomerId ? `Recipient customer ${facts.recipientCustomerId}` : null,
    item.customerId ? `Customer ${item.customerId}` : null,
  ];

  return html`
    <div className="detail-panel">
      <div className="details-grid">
        <section className="detail-section">
          <div className="detail-label">Appeal submission</div>
          <div className="detail-value">${facts.appealReason}</div>
          ${facts.evidence.length ? html`
            <div className="detail-list">
              ${facts.evidence.map((evidenceItem, index) => html`<div key=${`${item.appealId}-evidence-${index}`} className="small muted">${evidenceItem}</div>`)}
            </div>
          ` : html`
            <div className="small muted">No supporting evidence was attached to this appeal.</div>
          `}
        </section>

        <section className="detail-section">
          <div className="detail-label">Linked transaction</div>
          <div className="row small muted">
            ${transactionFacts.filter(Boolean).map((fact) => html`<span key=${`${item.appealId}-${fact}`} className="pill">${fact}</span>`)}
          </div>
          <div className="small muted">Created ${formatTimestamp(facts.createdAt)}</div>
          <div className="small muted">Last updated ${formatTimestamp(facts.updatedAt)}</div>
          ${facts.outcomeReason ? html`
            <div className="small muted">Decision reason: ${facts.outcomeReason}</div>
          ` : null}
        </section>

        <section className="detail-section">
          <div className="detail-label">Parties involved</div>
          ${renderFactList(peopleFacts)}
        </section>
      </div>
    </div>
  `;
};

const App = () => {
  const [state, setState] = useState({
    user: null,
    reviews: [],
    appeals: [],
    refreshLabel: 'Refreshing...',
  });
  const [notes, setNotes] = useState({});
  const [expandedRows, setExpandedRows] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const handlers = useMemo(() => ({
    onUnauthorized: () => { window.location.href = loginUrl; },
    onForbidden: () => { window.location.href = '/forbidden'; },
  }), []);

  const currentUserId = state.user?.userId || '';
  const mine = (claimedBy) => Boolean(claimedBy && claimedBy === currentUserId);

  const refresh = async () => {
    setError('');
    const [session, reviewsResponse, appealsResponse] = await Promise.all([
      fetchJson('/api/staff/me', {}, handlers),
      fetchJson('/api/v1/review-cases?status=PENDING,IN_REVIEW&limit=50&offset=0', {}, handlers),
      fetchJson('/api/v1/reviews/appeals/pending?limit=50&offset=0', {}, handlers),
    ]);

    setState({
      user: session.user,
      reviews: reviewsResponse.data || [],
      appeals: appealsResponse.data || [],
      refreshLabel: `Updated ${new Date().toLocaleTimeString()}`,
    });
  };

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    const id = setInterval(() => refresh().catch(() => {}), 20000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRow = (type, id) => {
    const key = `${type}:${id}`;
    setExpandedRows((prev) => toggleExpanded(prev, key));
  };

  const actionButtons = (type, itemId, claimedBy, status) => {
    const mineNow = mine(claimedBy);
    const normalized = String(status || '').toUpperCase();
    const inReview = ['IN_REVIEW', 'UNDER_REVIEW'].includes(normalized);
    const open = ['PENDING', 'OPEN'].includes(normalized);

    const trigger = (event, action, resolution = null) => {
      event.stopPropagation();
      callAction(type, itemId, action, resolution);
    };

    return html`
      <div className="row table-actions" onClick=${stopRowToggle} onMouseDown=${stopRowToggle}>
        <button
          className="btn btn-ghost"
          disabled=${!open || busyKey === `${type}:${itemId}:claim`}
          onClick=${(event) => trigger(event, 'claim')}
        >
          Claim
        </button>
        <button
          className="btn btn-ghost"
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:release`}
          onClick=${(event) => trigger(event, 'release')}
        >
          Release
        </button>
        <button
          className="btn btn-success"
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:approve`}
          onClick=${(event) => trigger(event, 'resolve', type === 'review' ? 'APPROVED' : 'REVERSE')}
        >
          ${type === 'review' ? 'Approve' : 'Reverse'}
        </button>
        <button
          className="btn btn-danger"
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:decline`}
          onClick=${(event) => trigger(event, 'resolve', type === 'review' ? 'DECLINED' : 'UPHOLD')}
        >
          ${type === 'review' ? 'Decline' : 'Uphold'}
        </button>
      </div>
    `;
  };

  const callAction = async (type, id, action, resolution = null) => {
    setError('');
    setSuccess('');
    const key = `${type}:${id}:${action === 'resolve' ? String(resolution).toLowerCase() : action}`;
    setBusyKey(key);

    try {
      const noteKey = `${type}:${id}`;
      const note = notes[noteKey] || '';
      let url = '';
      let body = {};

      if (type === 'review') {
        if (action === 'claim') {
          url = `/api/v1/review-cases/${encodeURIComponent(id)}/claim`;
          body = { claimTtlMinutes: 10 };
        } else if (action === 'release') {
          url = `/api/v1/review-cases/${encodeURIComponent(id)}/release`;
          body = { notes: note };
        } else {
          url = `/api/v1/reviews/${encodeURIComponent(id)}/decision`;
          body = { decision: resolution, notes: note };
        }
      } else if (action === 'claim') {
        url = `/api/v1/reviews/appeals/${encodeURIComponent(id)}/claim`;
        body = { claimTtlMinutes: 10 };
      } else if (action === 'release') {
        url = `/api/v1/reviews/appeals/${encodeURIComponent(id)}/release`;
        body = { notes: note };
      } else {
        url = `/api/v1/reviews/appeals/${encodeURIComponent(id)}/resolve`;
        body = { resolution, notes: note };
      }

      await fetchJson(url, {
        method: 'POST',
        body: JSON.stringify(body),
      }, handlers);

      setSuccess(`${type === 'review' ? 'Review case' : 'Appeal'} updated successfully.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey('');
    }
  };

  const summary = {
    pendingReviews: state.reviews.filter((item) => item.queueStatus === 'PENDING').length,
    myReviews: state.reviews.filter((item) => mine(item.claimedBy)).length,
    pendingAppeals: state.appeals.filter((item) => item.currentStatus === 'OPEN').length,
    myAppeals: state.appeals.filter((item) => mine(item.claimedBy)).length,
  };

  const logout = async () => {
    await fetch('/api/staff/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    window.location.href = loginUrl;
  };

  return html`
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-dot"></span>
          Fraud Review Console
        </div>
        <div className="row">
          <span className="badge">${state.user?.role || 'loading session...'}</span>
          <span className="badge">${state.user?.displayName || state.user?.userId || '-'}</span>
          <button className="btn btn-ghost" onClick=${logout}>Logout</button>
        </div>
      </div>
    </header>

    <main className="app-shell">
      <section className="hero">
        <span className="hero-chip">Ownership-first queue</span>
        <h1>Manual review and appeal actions</h1>
        <p>Claim, release, and final decisions are all tracked against the authenticated staff identity.</p>
        <div className="grid cols-4" style=${{ marginTop: '1rem' }}>
          <div className="metric"><div className="metric-label">Open reviews</div><div className="metric-value">${formatNumber(state.reviews.length)}</div></div>
          <div className="metric"><div className="metric-label">Open appeals</div><div className="metric-value">${formatNumber(state.appeals.length)}</div></div>
          <div className="metric"><div className="metric-label">Assigned to me</div><div className="metric-value">${formatNumber(summary.myReviews + summary.myAppeals)}</div></div>
          <div className="metric"><div className="metric-label">Last refresh</div><div className="metric-value">${nowTime()}</div></div>
        </div>
      </section>

      <section className="row space-between" style=${{ marginTop: '1rem', marginBottom: '0.8rem' }}>
        <div className="muted small">${state.refreshLabel}</div>
        <button className="btn btn-primary" onClick=${() => refresh().catch((err) => setError(err.message))}>Refresh</button>
      </section>

      ${error ? html`<div className="alert alert-danger">${error}</div>` : null}
      ${success ? html`<div className="alert alert-success">${success}</div>` : null}

      <section className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-head row space-between">
          <h2 className="title-sm">Flagged Transactions</h2>
          <span className="badge">${formatNumber(state.reviews.length)} open</span>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Why flagged</th>
                  <th>Status</th>
                  <th>Claim owner</th>
                  <th>Decision owner</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${state.reviews.length ? state.reviews.flatMap((item) => {
                  const facts = extractReviewContext(item);
                  const rowKey = `review:${item.transactionId}`;
                  const expanded = Boolean(expandedRows[rowKey]);
                  const toggle = () => toggleRow('review', item.transactionId);

                  return [
                    html`
                      <tr
                        key=${`${rowKey}:summary`}
                        className=${`expandable-row${expanded ? ' is-expanded' : ''}`}
                        role="button"
                        tabIndex="0"
                        aria-expanded=${expanded}
                        onClick=${toggle}
                        onKeyDown=${(event) => onExpandableKeyDown(event, toggle)}
                      >
                        <td>
                          <div className="row row-preview" style=${{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div className="mono">${item.transactionId}</div>
                              <div className="row small muted" style=${{ marginTop: '0.35rem', gap: '0.35rem', flexWrap: 'wrap' }}>
                                <span className="pill">Customer ${item.customerId || '-'}</span>
                                <span className="pill">Risk ${facts.adjustedScore ?? item.riskScore ?? '-'}</span>
                                ${facts.createdAt ? html`<span className="pill">${new Date(facts.createdAt).toLocaleString()}</span>` : null}
                              </div>
                            </div>
                            <span className=${`expand-toggle${expanded ? ' open' : ''}`}>></span>
                          </div>
                        </td>
                        <td>${renderReviewSummary(facts)}</td>
                        <td><span className=${`pill ${queueStatusClass(item.queueStatus)}`}>${String(item.queueStatus || '').replace(/_/g, ' ')}</span></td>
                        <td>
                          <div>${item.claimedBy || 'Unclaimed'}</div>
                          <div className="muted small">${item.claimedRole || 'Awaiting assignment'}</div>
                        </td>
                        <td>
                          <div>${item.reviewedBy || 'Not decided'}</div>
                          <div className="muted small">${item.reviewedRole || 'Pending'}</div>
                        </td>
                        <td>
                          <textarea
                            className="textarea"
                            placeholder="Decision notes"
                            value=${notes[`review:${item.transactionId}`] ?? (item.reviewNotes || '')}
                            onClick=${stopRowToggle}
                            onFocus=${stopRowToggle}
                            onMouseDown=${stopRowToggle}
                            onInput=${(event) => setNotes((prev) => ({ ...prev, [`review:${item.transactionId}`]: event.target.value }))}
                          ></textarea>
                        </td>
                        <td>${actionButtons('review', item.transactionId, item.claimedBy, item.queueStatus)}</td>
                      </tr>
                    `,
                    expanded ? html`
                      <tr key=${`${rowKey}:detail`} className="detail-row">
                        <td colSpan="7">${renderReviewExpanded(facts)}</td>
                      </tr>
                    ` : null,
                  ].filter(Boolean);
                }) : html`
                  <tr><td colSpan="7" className="muted">No flagged transactions are waiting for review.</td></tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-head row space-between">
          <h2 className="title-sm">Appeal Queue</h2>
          <span className="badge">${formatNumber(state.appeals.length)} open</span>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Appeal</th>
                  <th>Status</th>
                  <th>Claim owner</th>
                  <th>Decision owner</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${state.appeals.length ? state.appeals.flatMap((item) => {
                  const facts = extractAppealContext(item);
                  const rowKey = `appeal:${item.appealId}`;
                  const expanded = Boolean(expandedRows[rowKey]);
                  const toggle = () => toggleRow('appeal', item.appealId);

                  return [
                    html`
                      <tr
                        key=${`${rowKey}:summary`}
                        className=${`expandable-row${expanded ? ' is-expanded' : ''}`}
                        role="button"
                        tabIndex="0"
                        aria-expanded=${expanded}
                        onClick=${toggle}
                        onKeyDown=${(event) => onExpandableKeyDown(event, toggle)}
                      >
                        <td>
                          <div className="row row-preview" style=${{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div className="mono">${item.appealId}</div>
                              <div className="row small muted" style=${{ marginTop: '0.35rem' }}>
                                <span className="pill">Txn ${item.transactionId || '-'}</span>
                                <span className="pill">Customer ${item.customerId || '-'}</span>
                                ${facts.transactionStatus ? html`<span className="pill">${facts.transactionStatus}</span>` : null}
                              </div>
                              <div className="muted small" style=${{ marginTop: '0.35rem' }}>
                                ${facts.appealReason}
                              </div>
                            </div>
                            <span className=${`expand-toggle${expanded ? ' open' : ''}`}>></span>
                          </div>
                        </td>
                        <td><span className=${`pill ${queueStatusClass(item.currentStatus)}`}>${String(item.currentStatus || '').replace(/_/g, ' ')}</span></td>
                        <td>
                          <div>${item.claimedBy || 'Unclaimed'}</div>
                          <div className="muted small">${item.claimedRole || 'Awaiting assignment'}</div>
                        </td>
                        <td>
                          <div>${item.reviewedBy || 'Not decided'}</div>
                          <div className="muted small">${item.resolvedRole || 'Pending'}</div>
                        </td>
                        <td>
                          <textarea
                            className="textarea"
                            placeholder="Resolution notes"
                            value=${notes[`appeal:${item.appealId}`] ?? (item.resolutionNotes || '')}
                            onClick=${stopRowToggle}
                            onFocus=${stopRowToggle}
                            onMouseDown=${stopRowToggle}
                            onInput=${(event) => setNotes((prev) => ({ ...prev, [`appeal:${item.appealId}`]: event.target.value }))}
                          ></textarea>
                        </td>
                        <td>${actionButtons('appeal', item.appealId, item.claimedBy, item.currentStatus)}</td>
                      </tr>
                    `,
                    expanded ? html`
                      <tr key=${`${rowKey}:detail`} className="detail-row">
                        <td colSpan="6">${renderAppealExpanded(facts, item)}</td>
                      </tr>
                    ` : null,
                  ].filter(Boolean);
                }) : html`
                  <tr><td colSpan="6" className="muted">No appeals are waiting for manual review.</td></tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  `;
};

mountApp('#app', App);

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

const renderReviewFacts = (facts) => {
  const detailItems = [
    facts.amount !== null ? `${facts.currency || 'USD'} ${Number(facts.amount).toFixed(2)}` : null,
    facts.country ? `Country ${facts.country}` : null,
    facts.merchantId ? `Merchant ${facts.merchantId}` : null,
    facts.cardType ? `Card ${facts.cardType}` : null,
  ].filter(Boolean);

  const scoreItems = [
    facts.originalScore !== null ? `Original score ${facts.originalScore}` : null,
    facts.adjustedScore !== null && facts.adjustedScore !== facts.originalScore ? `Adjusted score ${facts.adjustedScore}` : null,
    facts.mlScore !== null ? `ML score ${facts.mlScore}` : null,
    facts.mlConfidence !== null ? `Confidence ${formatNumber(Number(facts.mlConfidence) * 100)}%` : null,
    facts.modelVersion ? `Model ${facts.modelVersion}` : null,
  ].filter(Boolean);

  return html`
    <div style=${{ display: 'grid', gap: '0.45rem' }}>
      <div>
        <div className="small" style=${{ color: '#d8e4ff', fontWeight: 600 }}>Why it was flagged</div>
        <div className="muted small" style=${{ marginTop: '0.25rem' }}>${facts.decisionReason}</div>
      </div>
      ${facts.reasons.length ? html`
        <div style=${{ display: 'grid', gap: '0.25rem' }}>
          ${facts.reasons.slice(0, 4).map((reason) => html`<div className="small muted">- ${reason}</div>`)}
        </div>
      ` : null}
      ${facts.overrideReason ? html`
        <div className="small muted">
          Override: ${facts.overrideType || 'MANUAL_REVIEW'}${facts.overrideReason ? ` - ${facts.overrideReason}` : ''}
        </div>
      ` : null}
      ${detailItems.length ? html`
        <div className="row small muted" style=${{ gap: '0.35rem', flexWrap: 'wrap' }}>
          ${detailItems.map((item) => html`<span className="pill">${item}</span>`)}
        </div>
      ` : null}
      ${scoreItems.length ? html`
        <div style=${{ display: 'grid', gap: '0.25rem' }}>
          ${scoreItems.map((item) => html`<div className="small muted">${item}</div>`)}
        </div>
      ` : null}
      ${facts.adjustedScore !== null && facts.adjustedScore >= manualDeclineThreshold ? html`
        <div className="small" style=${{ color: '#ffcf8a' }}>
          Current policy auto-declines scores above 75. This case may have been queued before the rule update if it still appears here.
        </div>
      ` : null}
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

  const actionButtons = (type, itemId, claimedBy, status) => {
    const mineNow = mine(claimedBy);
    const normalized = String(status || '').toUpperCase();
    const inReview = ['IN_REVIEW', 'UNDER_REVIEW'].includes(normalized);
    const open = ['PENDING', 'OPEN'].includes(normalized);
    return html`
      <div className="row">
        <button
          className="btn btn-ghost"
          disabled=${!open || busyKey === `${type}:${itemId}:claim`}
          onClick=${() => callAction(type, itemId, 'claim')}
        >
          Claim
        </button>
        <button
          className="btn btn-ghost"
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:release`}
          onClick=${() => callAction(type, itemId, 'release')}
        >
          Release
        </button>
        <button
          className="btn btn-success"
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:approve`}
          onClick=${() => callAction(type, itemId, 'resolve', type === 'review' ? 'APPROVED' : 'REVERSE')}
        >
          ${type === 'review' ? 'Approve' : 'Reverse'}
        </button>
        <button
          className="btn btn-danger"
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:decline`}
          onClick=${() => callAction(type, itemId, 'resolve', type === 'review' ? 'DECLINED' : 'UPHOLD')}
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
      } else {
        if (action === 'claim') {
          url = `/api/v1/reviews/appeals/${encodeURIComponent(id)}/claim`;
          body = { claimTtlMinutes: 10 };
        } else if (action === 'release') {
          url = `/api/v1/reviews/appeals/${encodeURIComponent(id)}/release`;
          body = { notes: note };
        } else {
          url = `/api/v1/reviews/appeals/${encodeURIComponent(id)}/resolve`;
          body = { resolution, notes: note };
        }
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
                ${state.reviews.length ? state.reviews.map((item) => {
                  const facts = extractReviewContext(item);
                  return html`
                    <tr>
                      <td>
                        <div className="mono">${item.transactionId}</div>
                        <div className="row small muted" style=${{ marginTop: '0.35rem', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <span className="pill">Customer ${item.customerId || '-'}</span>
                          <span className="pill">Risk ${facts.adjustedScore ?? item.riskScore ?? '-'}</span>
                          ${facts.createdAt ? html`<span className="pill">${new Date(facts.createdAt).toLocaleString()}</span>` : null}
                        </div>
                      </td>
                      <td>${renderReviewFacts(facts)}</td>
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
                          onInput=${(event) => setNotes((prev) => ({ ...prev, [`review:${item.transactionId}`]: event.target.value }))}
                        ></textarea>
                      </td>
                      <td>${actionButtons('review', item.transactionId, item.claimedBy, item.queueStatus)}</td>
                    </tr>
                  `;
                }) : html`
                  <tr><td colspan="7" className="muted">No flagged transactions are waiting for review.</td></tr>
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
                ${state.appeals.length ? state.appeals.map((item) => html`
                  <tr>
                    <td>
                      <div className="mono">${item.appealId}</div>
                      <div className="row small muted" style=${{ marginTop: '0.35rem' }}>
                        <span className="pill">Txn ${item.transactionId || '-'}</span>
                        <span className="pill">Customer ${item.customerId || '-'}</span>
                      </div>
                      <div className="muted small" style=${{ marginTop: '0.35rem' }}>${item.appealReason || 'Customer dispute'}</div>
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
                        onInput=${(event) => setNotes((prev) => ({ ...prev, [`appeal:${item.appealId}`]: event.target.value }))}
                      ></textarea>
                    </td>
                    <td>${actionButtons('appeal', item.appealId, item.claimedBy, item.currentStatus)}</td>
                  </tr>
                `) : html`
                  <tr><td colspan="6" className="muted">No appeals are waiting for manual review.</td></tr>
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

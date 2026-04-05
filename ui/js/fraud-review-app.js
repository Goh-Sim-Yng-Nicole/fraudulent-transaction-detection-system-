import {
  html,
  useState,
  useEffect,
  useMemo,
  mountApp,
  fetchJson,
  nowTime,
  formatNumber,
  formatMoney,
  formatUtc,
} from './common.js';

const DetailRow = ({ label, value }) => html`
  <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '0.45rem 0', borderBottom: '1px solid var(--border)' }}>
    <span className="muted small" style=${{ flexShrink: 0 }}>${label}</span>
    <span style=${{ fontSize: '0.875rem', textAlign: 'right' }}>${value ?? '-'}</span>
  </div>
`;

const SectionHeading = ({ label }) => html`
  <div style=${{ padding: '0.6rem 0 0.2rem', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>${label}</div>
`;

const statusPill = (status) => {
  const val = String(status || '').toLowerCase();
  const cls = val.includes('approved') || val.includes('reverse') ? 'status-approved'
    : val.includes('reject') || val.includes('declined') || val.includes('uphold') ? 'status-rejected'
    : val.includes('flag') || val.includes('review') ? 'status-flagged'
    : 'status-pending';
  return html`<span className=${`pill ${cls}`}>${status || '-'}</span>`;
};

const CaseDetailModal = ({ item, type, txn, loading, onClose }) => html`
  <div className="modal-overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal" style=${{ maxWidth: '520px' }}>
      <div className="modal-head">
        <div className="modal-title">${type === 'review' ? 'Review Case Details' : 'Appeal Details'}</div>
        <button className="modal-close" onClick=${onClose}>✕</button>
      </div>
      <div className="modal-body" style=${{ padding: '0 1.25rem 1rem' }}>
        ${loading ? html`<div className="muted" style=${{ padding: '1.5rem 0', textAlign: 'center' }}>Loading transaction...</div>` : html`
          <${SectionHeading} label="Transaction" />
          <${DetailRow} label="Transaction ID" value=${html`<span className="mono" style=${{ fontSize: '0.75rem', wordBreak: 'break-all' }}>${txn?.transaction_id || item.transactionId || '-'}</span>`} />
          <${DetailRow} label="Status" value=${statusPill(txn?.status)} />
          <${DetailRow} label="Amount" value=${txn ? formatMoney(txn.currency, txn.amount) : '-'} />
          <${DetailRow} label="Card type" value=${txn?.card_type || '-'} />
          <${DetailRow} label="Country" value=${txn?.country || '-'} />
          <${DetailRow} label="Counterparty" value=${txn?.recipient_name || txn?.sender_name || txn?.merchant_id || '-'} />
          <${DetailRow} label="Date" value=${formatUtc(txn?.created_at)} />
          <${DetailRow} label="Outcome reason" value=${txn?.outcome_reason || '-'} />
          <${DetailRow} label="Risk score" value=${item.riskScore ?? item.ruleScore ?? txn?.fraud_score ?? '-'} />

          ${type === 'review' ? html`
            <${SectionHeading} label="Review Case" />
            <${DetailRow} label="Queue status" value=${String(item.queueStatus || '').replace(/_/g, ' ')} />
            <${DetailRow} label="Claimed by" value=${item.claimedBy ? `${item.claimedBy} (${item.claimedRole || '-'})` : 'Unclaimed'} />
            <${DetailRow} label="Decision by" value=${item.reviewedBy || 'Pending'} />
            <${DetailRow} label="Review notes" value=${item.reviewNotes || '-'} />
          ` : html`
            <${SectionHeading} label="Appeal" />
            <${DetailRow} label="Appeal ID" value=${html`<span className="mono" style=${{ fontSize: '0.75rem', wordBreak: 'break-all' }}>${item.appealId}</span>`} />
            <${DetailRow} label="Appeal status" value=${String(item.currentStatus || '').replace(/_/g, ' ')} />
            <${DetailRow} label="Appeal reason" value=${item.appealReason || '-'} />
            <${DetailRow} label="Claimed by" value=${item.claimedBy ? `${item.claimedBy} (${item.claimedRole || '-'})` : 'Unclaimed'} />
            <${DetailRow} label="Resolution" value=${item.resolution || 'Pending'} />
            <${DetailRow} label="Resolution notes" value=${item.resolutionNotes || '-'} />
          `}
        `}
      </div>
    </div>
  </div>
`;

const ConfirmModal = ({ action, onConfirm, onCancel }) => {
  const isReverse = action === 'REVERSE';
  const label = isReverse ? 'Reverse' : 'Uphold';
  const description = isReverse
    ? 'This will reverse the original fraud decision and resolve the appeal in the customer\'s favour. This action cannot be undone.'
    : 'This will uphold the original fraud decision and deny the customer\'s appeal. This action cannot be undone.';
  return html`
    <div className="modal-overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" style=${{ maxWidth: '400px' }}>
        <div className="modal-head">
          <div className="modal-title">Confirm: ${label} Appeal</div>
          <button className="modal-close" onClick=${onCancel}>✕</button>
        </div>
        <div className="modal-body" style=${{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style=${{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>${description}</p>
          <div style=${{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick=${onCancel}>Cancel</button>
            <button
              className=${isReverse ? 'btn btn-success' : 'btn btn-danger'}
              onClick=${onConfirm}
            >Confirm ${label}</button>
          </div>
        </div>
      </div>
    </div>
  `;
};

const GuideCard = () => {
  const [open, setOpen] = useState(false);
  return html`
    <section className="card" style=${{ marginTop: '1rem' }}>
      <button
        onClick=${() => setOpen((o) => !o)}
        style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', color: 'inherit', padding: '0.9rem 1.1rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        <div style=${{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="title-sm">Action Guide</span>
          <span className="muted small">— how the queue workflow works</span>
        </div>
        <span style=${{ fontSize: '0.75rem', opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </button>
      ${open ? html`
        <div className="card-body grid cols-2" style=${{ gap: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.9rem' }}>
          <div className="metric">
            <div className="title-sm" style=${{ marginBottom: '0.25rem' }}>Claim</div>
            <div className="muted small">Assign the case to yourself. Only one analyst can hold a case at a time. You must claim before you can make a decision.</div>
          </div>
          <div className="metric">
            <div className="title-sm" style=${{ marginBottom: '0.25rem' }}>Release</div>
            <div className="muted small">Give the case back to the queue without making a decision. Use this if you need to reassign or cannot complete the review.</div>
          </div>
          <div className="metric">
            <div className="title-sm" style=${{ color: 'var(--ok)', marginBottom: '0.25rem' }}>Approve / Reverse</div>
            <div className="muted small">For reviews: marks the transaction as approved. For appeals: reverses the original decision in the customer's favour.</div>
          </div>
          <div className="metric">
            <div className="title-sm" style=${{ color: 'var(--danger)', marginBottom: '0.25rem' }}>Decline / Uphold</div>
            <div className="muted small">For reviews: confirms the transaction is rejected. For appeals: upholds the original decision, denying the customer's dispute.</div>
          </div>
        </div>
      ` : null}
    </section>
  `;
};

const loginUrl = '/staff-login.html?redirect=/fraud-review.html';

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [pending, setPending] = useState(null); // { type, id, action, resolution }
  const [caseDetail, setCaseDetail] = useState(null); // { item, type, txn, loading }

  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.profile-dropdown') && !e.target.closest('.profile-trigger')) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlers = useMemo(() => ({
    onUnauthorized: () => { window.location.href = loginUrl; },
    onForbidden: () => { window.location.href = '/forbidden.html'; },
  }), []);

  const currentUserId = state.user?.userId || '';
  const mine = (claimedBy) => Boolean(claimedBy && claimedBy === currentUserId);

  const openCaseDetail = async (item, type) => {
    const transactionId = item.transactionId || item.transaction_id;
    // Show modal immediately with loading state
    setCaseDetail({ item, type, txn: null, loading: true });
    try {
      const txn = await fetchJson(`/api/v1/transactions/${encodeURIComponent(transactionId)}`, {}, handlers);
      setCaseDetail({ item, type, txn, loading: false });
    } catch (_err) {
      setCaseDetail({ item, type, txn: null, loading: false });
    }
  };

  const refresh = async () => {
    setError('');
    const [session, reviewsResponse, appealsResponse] = await Promise.all([
      fetchJson('/api/v1/staff/me', {}, handlers),
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
      <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        <button
          className="btn btn-ghost"
          style=${{ whiteSpace: 'nowrap' }}
          disabled=${!open || busyKey === `${type}:${itemId}:claim`}
          onClick=${() => callAction(type, itemId, 'claim')}
        >Claim</button>
        <button
          className="btn btn-ghost"
          style=${{ whiteSpace: 'nowrap' }}
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:release`}
          onClick=${() => callAction(type, itemId, 'release')}
        >Release</button>
        <button
          className="btn btn-success"
          style=${{ whiteSpace: 'nowrap' }}
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:approve`}
          onClick=${() => {
            const resolution = type === 'review' ? 'APPROVED' : 'REVERSE';
            if (type === 'appeal') { setPending({ type, id: itemId, action: 'resolve', resolution }); }
            else { callAction(type, itemId, 'resolve', resolution); }
          }}
        >${type === 'review' ? 'Approve' : 'Reverse'}</button>
        <button
          className="btn btn-danger"
          style=${{ whiteSpace: 'nowrap' }}
          disabled=${!(mineNow && inReview) || busyKey === `${type}:${itemId}:decline`}
          onClick=${() => {
            const resolution = type === 'review' ? 'DECLINED' : 'UPHOLD';
            if (type === 'appeal') { setPending({ type, id: itemId, action: 'resolve', resolution }); }
            else { callAction(type, itemId, 'resolve', resolution); }
          }}
        >${type === 'review' ? 'Decline' : 'Uphold'}</button>
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
    await fetch('/api/v1/staff/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    window.location.href = loginUrl;
  };

  return html`
    ${pending ? html`<${ConfirmModal}
      action=${pending.resolution}
      onConfirm=${() => { callAction(pending.type, pending.id, pending.action, pending.resolution); setPending(null); }}
      onCancel=${() => setPending(null)}
    />` : null}
    ${caseDetail ? html`<${CaseDetailModal}
      item=${caseDetail.item}
      type=${caseDetail.type}
      txn=${caseDetail.txn}
      loading=${caseDetail.loading}
      onClose=${() => setCaseDetail(null)}
    />` : null}
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <img src="/assets/images/app-logo.png" className="brand-logo" alt="FTDS" />
          Fraud Review Console
        </div>
        <div style=${{ position: 'relative' }}>
          <button className="profile-trigger" onClick=${() => setProfileOpen((o) => !o)}>
            <span className="profile-avatar">${(state.user?.displayName || 'A')[0].toUpperCase()}</span>
            <div className="profile-trigger-info">
              <span className="profile-trigger-name">${state.user?.displayName || state.user?.userId || 'Staff'}</span>
              <span className="profile-trigger-sub">${state.user?.role || 'loading...'}</span>
            </div>
            <span className="profile-caret">▾</span>
          </button>
          ${profileOpen ? html`
            <div className="profile-dropdown">
              <button className="profile-dropdown-item profile-dropdown-item--danger" onClick=${logout}>
                <span className="profile-dropdown-icon">⎋</span>
                <span>Logout</span>
              </button>
            </div>
          ` : null}
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

      <${GuideCard} />

      <section className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-head row space-between">
          <h2 className="title-sm">Flagged Transactions</h2>
          <span className="badge">${formatNumber(state.reviews.length)} open</span>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table style=${{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style=${{ width: '22%' }} />
                <col style=${{ width: '24%' }} />
                <col style=${{ width: '9%' }} />
                <col style=${{ width: '11%' }} />
                <col style=${{ width: '11%' }} />
                <col style=${{ width: '12%' }} />
                <col style=${{ width: '11%' }} />
              </colgroup>
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
                      <td
                        style=${{ verticalAlign: 'top', cursor: mine(item.claimedBy) ? 'pointer' : 'default' }}
                        onClick=${() => mine(item.claimedBy) && openCaseDetail(item, 'review')}
                      >
                        <div className="mono" style=${{ wordBreak: 'break-all', color: mine(item.claimedBy) ? 'var(--accent)' : 'inherit', textDecoration: mine(item.claimedBy) ? 'underline' : 'none', textUnderlineOffset: '3px' }}>${item.transactionId}</div>
                        ${mine(item.claimedBy) ? html`<div className="muted small" style=${{ marginTop: '0.2rem', fontSize: '0.7rem' }}>Click to view details</div>` : null}
                        <div className="row small muted" style=${{ marginTop: '0.35rem', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <span className="pill">Customer ${item.customerId || '-'}</span>
                          <span className="pill">Risk ${facts.adjustedScore ?? item.riskScore ?? '-'}</span>
                          ${facts.createdAt ? html`<span className="pill">${new Date(facts.createdAt).toLocaleString()}</span>` : null}
                        </div>
                      </td>
                      <td style=${{ verticalAlign: 'top' }}>${renderReviewFacts(facts)}</td>
                      <td style=${{ verticalAlign: 'top' }}><span className=${`pill ${queueStatusClass(item.queueStatus)}`}>${String(item.queueStatus || '').replace(/_/g, ' ')}</span></td>
                      <td style=${{ verticalAlign: 'top' }}>
                        <div>${item.claimedBy || 'Unclaimed'}</div>
                        <div className="muted small">${item.claimedRole || 'Awaiting assignment'}</div>
                      </td>
                      <td style=${{ verticalAlign: 'top' }}>
                        <div>${item.reviewedBy || 'Not decided'}</div>
                        <div className="muted small">${item.reviewedRole || 'Pending'}</div>
                      </td>
                      <td style=${{ verticalAlign: 'top' }}>
                        <textarea
                          className="textarea"
                          placeholder="Decision notes"
                          style=${{ width: '100%', minHeight: '60px' }}
                          value=${notes[`review:${item.transactionId}`] ?? (item.reviewNotes || '')}
                          onInput=${(event) => setNotes((prev) => ({ ...prev, [`review:${item.transactionId}`]: event.target.value }))}
                        ></textarea>
                      </td>
                      <td style=${{ verticalAlign: 'top' }}>${actionButtons('review', item.transactionId, item.claimedBy, item.queueStatus)}</td>
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
            <table style=${{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style=${{ width: '30%' }} />
                <col style=${{ width: '10%' }} />
                <col style=${{ width: '13%' }} />
                <col style=${{ width: '13%' }} />
                <col style=${{ width: '18%' }} />
                <col style=${{ width: '16%' }} />
              </colgroup>
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
                    <td
                      style=${{ verticalAlign: 'top', cursor: mine(item.claimedBy) ? 'pointer' : 'default' }}
                      onClick=${() => mine(item.claimedBy) && openCaseDetail(item, 'appeal')}
                    >
                      <div className="mono" style=${{ wordBreak: 'break-all', color: mine(item.claimedBy) ? 'var(--accent)' : 'inherit', textDecoration: mine(item.claimedBy) ? 'underline' : 'none', textUnderlineOffset: '3px' }}>${item.appealId}</div>
                      ${mine(item.claimedBy) ? html`<div className="muted small" style=${{ marginTop: '0.2rem', fontSize: '0.7rem' }}>Click to view details</div>` : null}
                      <div className="row small muted" style=${{ marginTop: '0.35rem', flexWrap: 'wrap' }}>
                        <span className="pill">Txn ${item.transactionId || '-'}</span>
                        <span className="pill">Customer ${item.customerId || '-'}</span>
                      </div>
                      <div className="muted small" style=${{ marginTop: '0.35rem' }}>${item.appealReason || 'Customer dispute'}</div>
                    </td>
                    <td style=${{ verticalAlign: 'top' }}><span className=${`pill ${queueStatusClass(item.currentStatus)}`}>${String(item.currentStatus || '').replace(/_/g, ' ')}</span></td>
                    <td style=${{ verticalAlign: 'top' }}>
                      <div>${item.claimedBy || 'Unclaimed'}</div>
                      <div className="muted small">${item.claimedRole || 'Awaiting'}</div>
                    </td>
                    <td style=${{ verticalAlign: 'top' }}>
                      <div>${item.reviewedBy || 'Not decided'}</div>
                      <div className="muted small">${item.resolvedRole || 'Pending'}</div>
                    </td>
                    <td style=${{ verticalAlign: 'top' }}>
                      <textarea
                        className="textarea"
                        placeholder="Resolution notes"
                        style=${{ width: '100%', minHeight: '60px' }}
                        value=${notes[`appeal:${item.appealId}`] ?? (item.resolutionNotes || '')}
                        onInput=${(event) => setNotes((prev) => ({ ...prev, [`appeal:${item.appealId}`]: event.target.value }))}
                      ></textarea>
                    </td>
                    <td style=${{ verticalAlign: 'top' }}>${actionButtons('appeal', item.appealId, item.claimedBy, item.currentStatus)}</td>
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

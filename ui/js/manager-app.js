import {
  html,
  useState,
  useMemo,
  useEffect,
  mountApp,
  fetchJson,
  formatNumber,
  formatPercent,
} from './common.js';

const loginUrl = '/staff-sign-in?redirect=/manager';

const roleIsOps = (role) => String(role || '').startsWith('ops_');

const formatDecimal = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

const App = () => {
  const [state, setState] = useState({
    user: null,
    dashboard: null,
    legacyDashboard: null,
    realtime: null,
    updatedLabel: 'Refreshing...',
  });
  const [error, setError] = useState('');

  const handlers = useMemo(() => ({
    onUnauthorized: () => { window.location.href = loginUrl; },
    onForbidden: () => { window.location.href = '/forbidden.html'; },
  }), []);

  const refresh = async () => {
    setError('');
    const [session, legacyDashboardResponse, dashboardResponse, realtimeResponse] = await Promise.all([
      fetchJson('/api/staff/me', {}, handlers),
      fetchJson('/api/analytics/dashboard', {}, handlers),
      fetchJson('/api/v1/analytics/dashboard?timeRange=24h', {}, handlers),
      fetchJson('/api/v1/analytics/realtime', {}, handlers),
    ]);

    const dashboard = dashboardResponse.data || {};
    const realtime = realtimeResponse.data || {};
    const generatedAt = new Date(
      legacyDashboardResponse?.updated_at
      || dashboard?.metadata?.generatedAt
      || realtime?.timestamp
      || Date.now(),
    );

    setState({
      user: session.user,
      legacyDashboard: legacyDashboardResponse || {},
      dashboard,
      realtime,
      updatedLabel: `Updated ${generatedAt.toLocaleString()}`,
    });
  };

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = async () => {
    await fetch('/api/staff/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    window.location.href = loginUrl;
  };

  const legacy = state.legacyDashboard || {};
  const dashboard = state.dashboard || {};
  const realtime = state.realtime || {};
  const approved = Number(legacy.transactions_approved || 0);
  const declined = Number(legacy.transactions_rejected || 0);
  const flagged = Number(legacy.transactions_flagged || 0);
  const totalTransactions = approved + declined + flagged;
  const approvalRate = totalTransactions > 0 ? (approved / totalTransactions) * 100 : 0;
  const declineRate = totalTransactions > 0 ? (declined / totalTransactions) * 100 : 0;
  const analystImpact = dashboard.analystImpact || {};
  const appealImpact = dashboard.appealImpact || {};
  const reviewShare = totalTransactions > 0
    ? (Number(analystImpact.totalManualReviews || legacy.transactions_reviewed || 0) / totalTransactions) * 100
    : 0;

  const overviewCards = [
    ['Transactions', formatNumber(totalTransactions), 'Processed in current local projection window'],
    ['Approval rate', formatPercent(approvalRate), 'Approved outcomes in this window'],
    ['Decline rate', formatPercent(declineRate), 'Declined outcomes in this window'],
    ['Manual reviews', formatNumber(legacy.transactions_reviewed), 'Cases routed through analyst lane'],
    ['Appeals created', formatNumber(legacy.appeals_created), 'Customer disputes submitted'],
    ['Appeals reversed', formatNumber(legacy.appeals_approved), 'Appeals that overturned prior decisions'],
  ];

  const decisionCards = [
    ['Recent decisions (5m)', formatNumber(realtime.totalDecisions), 'Fresh decisions near real time'],
    ['Realtime overrides', formatNumber(realtime.overrides), 'Cases where final path diverged from default flow'],
    ['Average risk score', formatDecimal(realtime.avgRiskScore), 'Current average risk in live stream'],
    ['Review turnaround (min)', formatDecimal(analystImpact.avgReviewTurnaroundMinutes), 'Average analyst completion time'],
    ['Appeal reverse rate', `${formatDecimal(appealImpact.reverseRate)}%`, 'Portion of appeals resolved as reverse'],
    ['Appeals pending', formatNumber(appealImpact.appealsPending), 'Open appeals awaiting decision'],
  ];

  const opsLinks = [
    { title: 'Grafana', description: 'Dashboards and service KPIs', href: 'http://localhost:3000/' },
    { title: 'Jaeger', description: 'Distributed tracing and latency paths', href: 'http://localhost:16686/' },
    { title: 'Prometheus', description: 'Metrics and target health', href: 'http://localhost:9090/' },
    { title: 'cAdvisor', description: 'Container runtime resource telemetry', href: 'http://localhost:9091/' },
  ];
  if (state.user?.role === 'ops_admin') {
    opsLinks.push({ title: 'Mailpit', description: 'OTP and operational mail inbox', href: 'http://localhost:8025/' });
  }

  return html`
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-dot"></span>
          Manager Console
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
        <span className="hero-chip">Decision oversight</span>
        <h1>Operational Snapshot</h1>
        <p>Fraud analytics and role-aware operations surfaces in one control view.</p>
        <div className="grid cols-4" style=${{ marginTop: '1rem' }}>
          <div className="metric"><div className="metric-label">Transactions</div><div className="metric-value">${formatNumber(totalTransactions)}</div></div>
          <div className="metric"><div className="metric-label">Approval rate</div><div className="metric-value">${formatPercent(approvalRate)}</div></div>
          <div className="metric"><div className="metric-label">Appeals</div><div className="metric-value">${formatNumber(legacy.appeals_created)}</div></div>
          <div className="metric"><div className="metric-label">Review pressure</div><div className="metric-value">${formatPercent(reviewShare)}</div></div>
        </div>
      </section>

      <section className="row space-between" style=${{ marginTop: '1rem', marginBottom: '0.9rem' }}>
        <span className="muted small">${state.updatedLabel}</span>
        <button className="btn btn-primary" onClick=${() => refresh().catch((err) => setError(err.message))}>Refresh</button>
      </section>

      ${error ? html`<div className="alert alert-danger">${error}</div>` : null}

      <section className="grid cols-3" style=${{ marginTop: '1rem' }}>
        ${overviewCards.map(([label, value, note]) => html`
          <article className="card">
            <div className="card-body">
              <div className="metric-label">${label}</div>
              <div className="metric-value">${value}</div>
              <div className="muted small" style=${{ marginTop: '0.45rem' }}>${note}</div>
            </div>
          </article>
        `)}
      </section>

      <section className="grid cols-2" style=${{ marginTop: '1rem' }}>
        <article className="card">
          <div className="card-head">
            <h2 className="title-sm">Decision Quality</h2>
            <div className="muted small">${dashboard?.metadata?.timeRange || '24h'} window</div>
          </div>
          <div className="card-body grid cols-2">
            ${decisionCards.map(([label, value, note]) => html`
              <div className="metric">
                <div className="metric-label">${label}</div>
                <div className="metric-value">${value}</div>
                <div className="muted small" style=${{ marginTop: '0.35rem' }}>${note}</div>
              </div>
            `)}
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h2 className="title-sm">Operations Access</h2>
            <div className="muted small">
              ${roleIsOps(state.user?.role) ? `Ops lane active (${state.user?.role})` : 'Analytics-only role'}
            </div>
          </div>
          <div className="card-body">
            ${roleIsOps(state.user?.role) ? html`
              <div className="grid cols-2">
                ${opsLinks.map((link) => html`
                  <a className="metric" href=${link.href} target="_blank" rel="noreferrer" style=${{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="title-sm">${link.title}</div>
                    <div className="muted small" style=${{ marginTop: '0.35rem' }}>${link.description}</div>
                  </a>
                `)}
              </div>
            ` : html`
              <div className="metric">
                <div className="muted small">
                  Observability links are restricted to operations roles. Fraud managers keep analytics visibility from this dashboard.
                </div>
              </div>
            `}
          </div>
        </article>
      </section>
    </main>
  `;
};

mountApp('#app', App);

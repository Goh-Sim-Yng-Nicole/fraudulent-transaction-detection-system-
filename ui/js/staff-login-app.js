import {
  html,
  useState,
  useMemo,
  useEffect,
  mountApp,
  fetchJson,
} from './common.js';

const roleAccess = {
  fraud_analyst: {
    defaultTarget: '/fraud-review.html',
    allowedPaths: ['/fraud-review.html'],
    allowedOrigins: [],
  },
  fraud_manager: {
    defaultTarget: '/manager.html',
    allowedPaths: ['/fraud-review.html', '/manager.html'],
    allowedOrigins: [],
  },
  ops_readonly: {
    defaultTarget: '/manager.html',
    allowedPaths: ['/manager.html'],
    allowedOrigins: ['http://localhost:3000', 'http://localhost:16686', 'http://localhost:9090', 'http://localhost:9091'],
  },
  ops_admin: {
    defaultTarget: '/manager.html',
    allowedPaths: ['/manager.html'],
    allowedOrigins: ['http://localhost:3000', 'http://localhost:16686', 'http://localhost:9090', 'http://localhost:9091', 'http://localhost:8025'],
  },
};

const cards = [
  {
    role: 'Fraud Analyst',
    summary: 'Handle manual review and appeals queue actions',
    surfaces: ['Fraud review console'],
  },
  {
    role: 'Fraud Manager',
    summary: 'Review queue plus managerial analytics access',
    surfaces: ['Fraud review console', 'Manager dashboard'],
  },
  {
    role: 'Ops Readonly',
    summary: 'Read-only visibility into observability surfaces',
    surfaces: ['Manager dashboard', 'Grafana', 'Jaeger', 'Prometheus', 'cAdvisor'],
  },
  {
    role: 'Ops Admin',
    summary: 'Ops observability plus Mailpit local mail tooling',
    surfaces: ['Manager dashboard', 'Grafana', 'Jaeger', 'Prometheus', 'cAdvisor', 'Mailpit'],
  },
];

const isRoleAllowedForRedirect = (role, target) => {
  const access = roleAccess[role];
  if (!access || !target) return false;
  try {
    const url = new URL(target, window.location.origin);
    if (url.pathname === '/staff-login.html' || url.pathname === '/forbidden.html') return false;
    if (url.origin === window.location.origin) return access.allowedPaths.includes(url.pathname);
    return access.allowedOrigins.includes(url.origin);
  } catch (_error) {
    return false;
  }
};

const resolveRedirect = (user, redirectTo) => {
  const access = roleAccess[user?.role];
  if (access && isRoleAllowedForRedirect(user.role, redirectTo)) {
    return new URL(redirectTo, window.location.origin).toString();
  }
  return access?.defaultTarget || '/manager.html';
};

const App = () => {
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const redirectTo = useMemo(() => new URLSearchParams(window.location.search).get('redirect') || '', []);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const session = await fetchJson('/api/staff/me');
        window.location.href = resolveRedirect(session.user, redirectTo);
      } catch (_error) {
        // no active session
      }
    };
    bootstrap();
  }, [redirectTo]);

  const login = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = await fetchJson('/api/staff/login', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
        }),
      });
      window.location.href = resolveRedirect(payload.user, redirectTo);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return html`
    <div className="app-shell">
      <section className="hero">
        <div className="hero-brand">
          <img src="/assets/images/app-logo.png" className="hero-logo" alt="FTDS" />
          <span className="hero-brand-name">FTDS</span>
        </div>
        <span className="hero-chip">Role-aware access</span>
        <h1>Staff and Operations Sign In</h1>
        <p>
          Gateway-issued staff sessions gate every protected page. Sign in once, then route safely based on your role.
        </p>
      </section>

      <section className="grid cols-2" style=${{ marginTop: '1rem' }}>
        <div className="card">
          <div className="card-body">
            <h2 className="title-sm" style=${{ marginBottom: '0.8rem' }}>Role access map</h2>
            <div className="grid cols-2">
              ${cards.map((card) => html`
                <article className="metric">
                  <div className="title-sm">${card.role}</div>
                  <div className="muted small" style=${{ marginTop: '0.35rem' }}>${card.summary}</div>
                  <div className="row" style=${{ marginTop: '0.6rem' }}>
                    ${card.surfaces.map((surface) => html`<span className="pill">${surface}</span>`)}
                  </div>
                </article>
              `)}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <h2 className="title-sm">Sign in to continue</h2>
            <p className="muted small" style=${{ marginTop: '0.4rem', marginBottom: '0.9rem' }}>
              Redirects are role-safe. If a target page is outside your permissions, you will land on your default console.
            </p>
            ${error ? html`<div className="alert alert-danger">${error}</div>` : null}
            <form className="grid" style=${{ gap: '0.8rem' }} onSubmit=${login}>
              <div className="field">
                <label>Username</label>
                <input
                  className="input"
                  autocomplete="username"
                  value=${form.username}
                  onInput=${(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  className="input"
                  type="password"
                  autocomplete="current-password"
                  value=${form.password}
                  onInput=${(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled=${loading}>
                ${loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
            <div className="muted small" style=${{ marginTop: '0.9rem' }}>
              Customers continue through <a href="/index.html">the banking customer portal</a>.
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
};

mountApp('#app', App);

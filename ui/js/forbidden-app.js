import { html, mountApp } from './common.js';

const App = () => html`
  <main className="app-shell" style=${{ maxWidth: '760px', paddingTop: '2rem' }}>
    <section className="hero">
      <span className="hero-chip">Access Control</span>
      <h1>Access denied</h1>
      <p>Your current staff role is not allowed to open this page.</p>
    </section>
    <section className="card" style=${{ marginTop: '1rem' }}>
      <div className="card-body row space-between">
        <div className="muted small">Sign in with a role that has access, or return to the appropriate console.</div>
        <div className="row">
          <a className="btn btn-ghost" href="/staff-sign-in">Staff sign in</a>
          <a className="btn btn-primary" href="/manager">Manager console</a>
        </div>
      </div>
    </section>
  </main>
`;

mountApp('#app', App);

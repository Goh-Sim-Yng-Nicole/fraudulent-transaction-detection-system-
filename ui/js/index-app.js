import {
  html,
  useState,
  useEffect,
  mountApp,
  API_ROOT,
  fetchJson,
  readCustomerSession,
  writeCustomerSession,
} from './common.js';

const phoneCodes = [
  '+65', '+60', '+62', '+63', '+66', '+84', '+86', '+81', '+82', '+91', '+44', '+1', '+61',
];

const decodeBase64UrlJson = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  const binary = window.atob(`${normalized}${padding}`);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

const App = () => {
  const [tab, setTab] = useState('login');
  const [pendingEmail, setPendingEmail] = useState('');
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState({ login: false, register: false, otp: false, resend: false, oauth: false });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    fullName: '',
    email: '',
    phoneCode: '+65',
    phoneNumber: '',
    password: '',
  });
  const [otpCode, setOtpCode] = useState('');

  useEffect(() => {
    const oauthPayload = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const oauthError = oauthPayload.get('oauth_error');
    const oauthToken = oauthPayload.get('oauth_token');
    const oauthCustomer = oauthPayload.get('oauth_customer');
    const oauthNext = oauthPayload.get('oauth_next') || '/banking';

    if (oauthError) {
      setAlert({ type: 'danger', message: oauthError });
      window.history.replaceState({}, '', '/index.html');
      return;
    }

    if (oauthToken && oauthCustomer) {
      try {
        const customer = decodeBase64UrlJson(oauthCustomer);
        writeCustomerSession(oauthToken, customer);
        window.location.href = oauthNext.startsWith('/') ? oauthNext : '/banking';
        return;
      } catch (_error) {
        setAlert({ type: 'danger', message: 'OAuth sign-in data was invalid. Please try again.' });
        window.history.replaceState({}, '', '/index.html');
      }
    }

    if (readCustomerSession()) {
      window.location.href = '/banking';
    }
  }, []);

  const setBusy = (key, value) => setLoading((prev) => ({ ...prev, [key]: value }));

  const submitLogin = async (event) => {
    event.preventDefault();
    setAlert(null);
    setBusy('login', true);
    try {
      const payload = await fetchJson(`${API_ROOT}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({
          email: loginForm.email.trim(),
          password: loginForm.password,
        }),
      });

      if (payload.requires_otp) {
        setPendingEmail(loginForm.email.trim());
        return;
      }

      if (payload.access_token && payload.customer) {
        writeCustomerSession(payload.access_token, payload.customer);
        window.location.href = '/banking';
        return;
      }

      throw new Error('Unexpected login response');
    } catch (error) {
      setAlert({ type: 'danger', message: error.message });
    } finally {
      setBusy('login', false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    setAlert(null);
    setBusy('register', true);
    try {
      const payload = await fetchJson(`${API_ROOT}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({
          full_name: registerForm.fullName.trim(),
          email: registerForm.email.trim(),
          phone: `${registerForm.phoneCode}${registerForm.phoneNumber.replace(/[\s\-()]/g, '')}`,
          password: registerForm.password,
        }),
      });
      if (payload.requires_otp) {
        setPendingEmail(registerForm.email.trim());
        setAlert({ type: 'success', message: payload.message || 'Verification code sent to your email.' });
        return;
      }

      if (payload.access_token && payload.customer) {
        writeCustomerSession(payload.access_token, payload.customer);
        window.location.href = '/banking';
        return;
      }

      throw new Error('Unexpected registration response');
    } catch (error) {
      setAlert({ type: 'danger', message: error.message });
    } finally {
      setBusy('register', false);
    }
  };

  const startOAuth = (provider = 'google') => {
    setBusy('oauth', true);
    const query = new URLSearchParams({ provider, next: '/banking' });
    window.location.href = `${API_ROOT}/auth/oauth/start?${query.toString()}`;
  };

  const submitOtp = async (event) => {
    event.preventDefault();
    setAlert(null);
    setBusy('otp', true);
    try {
      const payload = await fetchJson(`${API_ROOT}/auth/verify-otp`, {
        method: 'POST',
        body: JSON.stringify({
          email: pendingEmail,
          otp_code: otpCode.trim(),
        }),
      });
      writeCustomerSession(payload.access_token, payload.customer);
      window.location.href = '/banking';
    } catch (error) {
      setAlert({ type: 'danger', message: error.message });
      setOtpCode('');
    } finally {
      setBusy('otp', false);
    }
  };

  const resendOtp = async () => {
    if (!pendingEmail) return;
    setAlert(null);
    setBusy('resend', true);
    try {
      await fetchJson(`${API_ROOT}/auth/resend-otp`, {
        method: 'POST',
        body: JSON.stringify({ email: pendingEmail }),
      });
      setAlert({ type: 'success', message: `A new code was sent to ${pendingEmail}.` });
    } catch (error) {
      setAlert({ type: 'danger', message: error.message });
    } finally {
      setBusy('resend', false);
    }
  };

  return html`
    <div className="app-shell" style=${{ maxWidth: '960px', paddingTop: '2rem' }}>
      <section className="hero">
        <span className="hero-chip">Customer Access</span>
        <h1>FTDS Banking Portal</h1>
        <p>
          Secure customer authentication with OTP verification, then move into your transaction workspace.
          Staff users should sign in through the dedicated staff console.
        </p>
      </section>

      <section className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-body">
          ${alert ? html`
            <div className=${`alert alert-${alert.type === 'success' ? 'success' : alert.type === 'warning' ? 'warning' : 'danger'}`}>
              ${alert.message}
            </div>
          ` : null}

          ${pendingEmail ? html`
            <form onSubmit=${submitOtp} className="grid" style=${{ gap: '0.8rem' }}>
              <div className="field">
                <label>Email verification</label>
                <div className="badge">Code sent to ${pendingEmail}</div>
              </div>
              <div className="field">
                <label>OTP code</label>
                <input
                  className="input mono"
                  maxlength="6"
                  pattern="\\d{6}"
                  value=${otpCode}
                  onInput=${(event) => setOtpCode(event.target.value)}
                  placeholder="000000"
                  required
                />
              </div>
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled=${loading.otp}>
                  ${loading.otp ? 'Verifying...' : 'Verify and continue'}
                </button>
                <button className="btn btn-ghost" type="button" disabled=${loading.resend} onClick=${resendOtp}>
                  ${loading.resend ? 'Sending...' : 'Resend OTP'}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick=${() => {
                    setPendingEmail('');
                    setOtpCode('');
                    setAlert(null);
                  }}
                >
                  Back
                </button>
              </div>
            </form>
          ` : html`
            <div style=${{ marginBottom: '0.9rem' }}>
              <button className="btn btn-ghost" type="button" disabled=${loading.oauth} onClick=${() => startOAuth('google')}>
                ${loading.oauth ? 'Redirecting...' : 'Continue with Google'}
              </button>
            </div>
            <div className="tabs" role="tablist" style=${{ marginBottom: '0.9rem' }}>
              <button className=${`tab ${tab === 'login' ? 'active' : ''}`} type="button" onClick=${() => setTab('login')}>Sign in</button>
              <button className=${`tab ${tab === 'register' ? 'active' : ''}`} type="button" onClick=${() => setTab('register')}>Create account</button>
            </div>

            ${tab === 'login' ? html`
              <form onSubmit=${submitLogin} className="grid" style=${{ gap: '0.8rem' }}>
                <div className="field">
                  <label>Email</label>
                  <input
                    className="input"
                    type="email"
                    value=${loginForm.email}
                    onInput=${(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    className="input"
                    type="password"
                    value=${loginForm.password}
                    onInput=${(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                    required
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled=${loading.login}>
                  ${loading.login ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
            ` : html`
              <form onSubmit=${submitRegister} className="grid" style=${{ gap: '0.8rem' }}>
                <div className="field">
                  <label>Full name</label>
                  <input
                    className="input"
                    value=${registerForm.fullName}
                    onInput=${(event) => setRegisterForm((prev) => ({ ...prev, fullName: event.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input
                    className="input"
                    type="email"
                    value=${registerForm.email}
                    onInput=${(event) => setRegisterForm((prev) => ({ ...prev, email: event.target.value }))}
                    required
                  />
                </div>
                <div className="grid cols-2">
                  <div className="field">
                    <label>Phone code</label>
                    <select
                      className="select"
                      value=${registerForm.phoneCode}
                      onChange=${(event) => setRegisterForm((prev) => ({ ...prev, phoneCode: event.target.value }))}
                    >
                      ${phoneCodes.map((code) => html`<option value=${code}>${code}</option>`)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Phone number</label>
                    <input
                      className="input"
                      type="tel"
                      value=${registerForm.phoneNumber}
                      onInput=${(event) => setRegisterForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Password (min 8 chars)</label>
                  <input
                    className="input"
                    type="password"
                    minlength="8"
                    value=${registerForm.password}
                    onInput=${(event) => setRegisterForm((prev) => ({ ...prev, password: event.target.value }))}
                    required
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled=${loading.register}>
                  ${loading.register ? 'Creating account...' : 'Create account'}
                </button>
              </form>
            `}
          `}
        </div>
      </section>

      <section className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-body row space-between">
          <div>
            <div className="title-sm">Staff sign-in</div>
            <div className="muted small">Fraud analysts, managers, and ops users sign in through the protected staff console.</div>
          </div>
          <a className="btn btn-ghost" href="/staff-sign-in">Open staff console</a>
        </div>
      </section>
    </div>
  `;
};

mountApp('#app', App);

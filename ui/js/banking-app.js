import {
  html,
  useState,
  useEffect,
  mountApp,
  fetchJson,
  readCustomerSession,
  writeCustomerSession,
  clearCustomerSession,
  formatMoney,
  formatUtc,
} from './common.js';

const TxnDetailModal = ({ txn, fmtDate, onClose }) => html`
  <div className="modal-overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal" style=${{ maxWidth: '480px' }}>
      <div className="modal-head">
        <div className="modal-title">Transaction Details</div>
        <button className="modal-close" onClick=${onClose}>✕</button>
      </div>
      <div className="modal-body grid" style=${{ gap: '0.6rem' }}>
        ${[
          ['Transaction ID', html`<span className="mono" style=${{ fontSize: '0.78rem', wordBreak: 'break-all' }}>${txn.transaction_id}</span>`],
          ['Status', html`<span className=${`pill ${
            String(txn.status||'').toLowerCase().includes('approved') ? 'status-approved' :
            String(txn.status||'').toLowerCase().includes('reject') ? 'status-rejected' :
            String(txn.status||'').toLowerCase().includes('flag') ? 'status-flagged' : 'status-pending'
          }`}>${txn.status}</span>`],
          ['Amount', formatMoney(txn.currency, txn.amount)],
          ['Card type', txn.card_type || '-'],
          ['Country', txn.country || '-'],
          ['Counterparty', txn.recipient_name || txn.sender_name || txn.merchant_id || '-'],
          ['Date', fmtDate(txn.created_at)],
          ['Outcome reason', txn.outcome_reason || '-'],
        ].map(([label, value]) => html`
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
            <span className="muted small">${label}</span>
            <span style=${{ fontSize: '0.875rem', textAlign: 'right' }}>${value}</span>
          </div>
        `)}
      </div>
    </div>
  </div>
`;

// Routing:
//   /api/auth/*  → customer service (customer:8005)  via nginx rewrite
//   /api/v1/*    → gateway (gateway:8004/api/v1/*)   passthrough
const AUTH = '/api/auth';
const V1 = '/api/v1';

const ProfileModal = ({ customer, hasLocalPassword, profileForm, setProfileForm, passwordForm, setPasswordForm, deleteForm, setDeleteForm, busy, saveProfile, requestOtp, changePassword, setInitialPassword, deleteAccount, onClose }) => {
  const [tab, setTab] = useState('profile');
  return html`
    <div className="modal-overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-head">
          <div style=${{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span className="profile-avatar profile-avatar-lg">${(customer.full_name || 'U')[0].toUpperCase()}</span>
            <div>
              <div className="modal-title">${customer.full_name}</div>
              <div style=${{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.1rem' }}>${customer.email}</div>
            </div>
          </div>
          <button className="modal-close" onClick=${onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <button className=${tab === 'profile' ? 'modal-tab active' : 'modal-tab'} onClick=${() => setTab('profile')}>Profile</button>
          <button className=${tab === 'password' ? 'modal-tab active' : 'modal-tab'} onClick=${() => setTab('password')}>Password</button>
          <button className=${tab === 'danger' ? 'modal-tab active' : 'modal-tab'} onClick=${() => setTab('danger')}>Account</button>
        </div>
        ${tab === 'profile' ? html`
          <div className="modal-body grid" style=${{ gap: '0.65rem' }}>
            ${!hasLocalPassword ? html`<div className="alert alert-warning" style=${{ fontSize: '0.8rem' }}>Set a password first to unlock profile edits.</div>` : null}
            <div className="field"><label>Full name</label><input className="input" value=${profileForm.full_name} onInput=${(e) => setProfileForm((p) => ({ ...p, full_name: e.target.value }))} /></div>
            <div className="field"><label>Email</label><input className="input" value=${profileForm.email} readonly /></div>
            <div className="field"><label>Phone</label><input className="input" value=${profileForm.phone} onInput=${(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} /></div>
            <button className="btn btn-primary" onClick=${saveProfile} disabled=${busy.profile || !hasLocalPassword}>${busy.profile ? 'Saving...' : 'Save profile'}</button>
          </div>
        ` : null}
        ${tab === 'password' ? html`
          <div className="modal-body grid" style=${{ gap: '0.65rem' }}>
            <button className="btn btn-ghost" onClick=${requestOtp} disabled=${busy.otp}>${busy.otp ? 'Sending OTP...' : hasLocalPassword ? 'Request OTP' : 'Request setup OTP'}</button>
            ${hasLocalPassword ? html`<div className="field"><label>Current password</label><input className="input" type="password" value=${passwordForm.current_password} onInput=${(e) => setPasswordForm((p) => ({ ...p, current_password: e.target.value }))} /></div>` : null}
            <div className="field"><label>New password</label><input className="input" type="password" value=${passwordForm.new_password} onInput=${(e) => setPasswordForm((p) => ({ ...p, new_password: e.target.value }))} /></div>
            <div className="field"><label>Email OTP</label><input className="input mono" value=${passwordForm.otp_code} onInput=${(e) => setPasswordForm((p) => ({ ...p, otp_code: e.target.value }))} /></div>
            <button className="btn btn-primary" onClick=${hasLocalPassword ? changePassword : setInitialPassword} disabled=${busy.password}>${busy.password ? (hasLocalPassword ? 'Changing...' : 'Setting...') : (hasLocalPassword ? 'Change password' : 'Set password')}</button>
          </div>
        ` : null}
        ${tab === 'danger' ? html`
          <div className="modal-body grid" style=${{ gap: '0.65rem' }}>
            <div className="alert alert-warning" style=${{ fontSize: '0.82rem' }}>${hasLocalPassword ? 'This action is irreversible. Your account will be deactivated immediately.' : 'Set a local password first before deleting this account.'}</div>
            ${hasLocalPassword ? html`
              <div className="field"><label>Password</label><input className="input" type="password" value=${deleteForm.password} onInput=${(e) => setDeleteForm((p) => ({ ...p, password: e.target.value }))} /></div>
              <div className="field"><label>Email OTP</label><input className="input mono" value=${deleteForm.otp_code} onInput=${(e) => setDeleteForm((p) => ({ ...p, otp_code: e.target.value }))} /></div>
              <button className="btn btn-danger" onClick=${deleteAccount} disabled=${busy.delete}>${busy.delete ? 'Deleting...' : 'Delete account'}</button>
            ` : html`<div className="muted small">Request the setup OTP from the Password tab, set a local password, then return here.</div>`}
          </div>
        ` : null}
      </div>
    </div>
  `;
};

const statusClass = (status) => {
  const value = String(status || '').toLowerCase();
  if (value.includes('pending') || value.includes('open')) return 'status-pending';
  if (value.includes('flag') || value.includes('review')) return 'status-flagged';
  if (value.includes('approved') || value.includes('resolved')) return 'status-approved';
  if (value.includes('reject') || value.includes('declined')) return 'status-rejected';
  return '';
};

const currencies = ['SGD', 'USD', 'EUR', 'GBP', 'MYR', 'CNY'];
const countries = ['SG', 'AU', 'BR', 'CA', 'CN', 'DE', 'FR', 'GB', 'ID', 'IN', 'JP', 'MY', 'NG', 'PH', 'PK', 'RU', 'UA', 'US'];
const cardTypes = ['CREDIT', 'DEBIT', 'PREPAID'];

const App = () => {
  const [session, setSession] = useState(null);
  const [direction, setDirection] = useState('all');
  const [transactions, setTransactions] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState({});

  const [txnForm, setTxnForm] = useState({
    recipientType: 'merchant',
    merchantId: '',
    recipientQuery: '',
    amount: '',
    currency: 'SGD',
    cardType: 'CREDIT',
    country: 'SG',
  });

  const [appealDraft, setAppealDraft] = useState({ transactionId: '', reason: '' });
  const [profileForm, setProfileForm] = useState({ full_name: '', email: '', phone: '' });
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', otp_code: '' });
  const [deleteForm, setDeleteForm] = useState({ password: '', otp_code: '' });
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [txnDetail, setTxnDetail] = useState(null);
  const [showUtc, setShowUtc] = useState(() => localStorage.getItem('ftds_show_utc') !== 'false');
  const toUtcClock = () => new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  const toLocalClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const [nowUtc, setNowUtc] = useState(toUtcClock);
  const fmtDate = (v) => {
    if (!v) return '-';
    if (showUtc) return formatUtc(v);
    return new Date(v).toLocaleString(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short',
    });
  };
  const toggleUtc = () => {
    const next = !showUtc;
    setShowUtc(next);
    localStorage.setItem('ftds_show_utc', String(next));
  };

  const token = session?.token || '';
  const customer = session?.customer || null;
  const headers = { Authorization: `Bearer ${token}` };
  const hasLocalPassword = customer?.has_password !== false;
  const appealedTransactionIds = new Set(appeals.map((appeal) => appeal.transactionId));
  const selectedTransactionAlreadyAppealed = appealedTransactionIds.has(appealDraft.transactionId);
  const appealableTransactions = transactions.filter(
    (txn) => String(txn.status || '').toUpperCase() === 'REJECTED' && !appealedTransactionIds.has(txn.transaction_id),
  );
  const hasAppealable = appealableTransactions.length > 0;

  const logout = () => {
    clearCustomerSession();
    window.location.href = '/index.html';
  };

  const setLoading = (key, value) => setBusy((prev) => ({ ...prev, [key]: value }));
  const showMessage = (type, text) => setMessage({ type, text });

  const syncCustomerProfile = async () => {
    if (!token) return;
    const payload = await fetchJson(`${AUTH}/me`, { headers });
    writeCustomerSession(token, payload);
    setSession({ token, customer: payload });
    setProfileForm({
      full_name: payload.full_name || '',
      email: payload.email || '',
      phone: payload.phone || '',
    });
  };

  const loadTransactions = async (currentDirection = direction) => {
    if (!customer) return;
    const payload = await fetchJson(
      `${V1}/transactions?customer_id=${encodeURIComponent(customer.customer_id)}&direction=${encodeURIComponent(currentDirection)}`,
      { headers },
    );
    setTransactions(Array.isArray(payload) ? payload : []);
  };

  const loadAppeals = async () => {
    if (!customer) return;
    const payload = await fetchJson(
      `${V1}/appeals/customer/${encodeURIComponent(customer.customer_id)}`,
      { headers },
    );
    const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
    setAppeals(list);
  };

  useEffect(() => {
    const saved = readCustomerSession();
    if (!saved) {
      window.location.href = '/index.html';
      return;
    }
    setSession(saved);
    setProfileForm({
      full_name: saved.customer.full_name || '',
      email: saved.customer.email || '',
      phone: saved.customer.phone || '',
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    if (typeof session.customer?.has_password === 'undefined') {
      syncCustomerProfile().catch(() => {});
    }
    Promise.all([loadTransactions(), loadAppeals()]).catch(() => {});
  }, [session, direction]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => setNowUtc(showUtc ? toUtcClock() : toLocalClock()), 1000);
    setNowUtc(showUtc ? toUtcClock() : toLocalClock());
    return () => clearInterval(id);
  }, [showUtc]);

  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.profile-dropdown') && !e.target.closest('.profile-trigger')) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const pollId = setInterval(() => {
      const hasPending = transactions.some((txn) => ['PENDING', 'FLAGGED'].includes(String(txn.status || '').toUpperCase()));
      if (hasPending) loadTransactions().catch(() => {});
    }, 4000);
    return () => clearInterval(pollId);
  }, [transactions]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookupRecipient = async () => {
    if (!txnForm.recipientQuery.trim()) return;
    setLoading('lookup', true);
    try {
      const payload = await fetchJson(
        `${AUTH}/lookup?query=${encodeURIComponent(txnForm.recipientQuery.trim())}`,
        { headers },
      );
      setRecipient(payload);
      showMessage('success', `Recipient found: ${payload.full_name}`);
    } catch (error) {
      showMessage('danger', error.message);
      setRecipient(null);
    } finally {
      setLoading('lookup', false);
    }
  };

  const submitTransaction = async (event) => {
    event.preventDefault();
    showMessage('', '');
    if (!hasLocalPassword) {
      showMessage('danger', 'Set a local password before creating transactions.');
      return;
    }
    const transferToCustomer = txnForm.recipientType === 'customer';
    if (transferToCustomer && !recipient?.customer_id) {
      showMessage('danger', 'Please look up and confirm recipient first.');
      return;
    }

    setLoading('txn', true);
    try {
      const body = {
        amount: Number(txnForm.amount),
        currency: txnForm.currency,
        card_type: txnForm.cardType,
        country: txnForm.country,
        merchant_id: transferToCustomer ? null : (txnForm.merchantId || null),
        customer_id: customer.customer_id,
        sender_name: customer.full_name,
      };
      if (transferToCustomer) {
        body.recipient_customer_id = recipient.customer_id;
        body.recipient_name = recipient.full_name;
      }

      const payload = await fetchJson(`${V1}/transactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      setTxnForm({
        recipientType: 'merchant',
        merchantId: '',
        recipientQuery: '',
        amount: '',
        currency: 'SGD',
        cardType: 'CREDIT',
        country: 'SG',
      });
      setRecipient(null);
      showMessage('success', `Transaction submitted: ${payload.transaction_id.slice(0, 8)}...`);
      await loadTransactions();
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('txn', false);
    }
  };

  const submitAppeal = async () => {
    if (!hasLocalPassword) {
      showMessage('danger', 'Set a local password before submitting appeals.');
      return;
    }
    if (!appealDraft.transactionId || !appealDraft.reason.trim()) {
      showMessage('danger', 'Pick a transaction and provide a reason for appeal.');
      return;
    }
    if (selectedTransactionAlreadyAppealed) {
      showMessage('danger', 'This transaction has already been appealed.');
      return;
    }
    setLoading('appeal', true);
    try {
      await fetchJson(`${V1}/appeals`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactionId: appealDraft.transactionId,
          customerId: customer.customer_id,
          appealReason: appealDraft.reason.trim(),
        }),
      });
      setAppealDraft({ transactionId: '', reason: '' });
      showMessage('success', 'Appeal submitted successfully.');
      await Promise.all([loadTransactions(), loadAppeals()]);
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('appeal', false);
    }
  };

  const saveProfile = async () => {
    if (!hasLocalPassword) {
      showMessage('danger', 'Set a local password before updating your profile.');
      return;
    }
    setLoading('profile', true);
    try {
      const payload = await fetchJson(`${AUTH}/me`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          full_name: profileForm.full_name.trim() || null,
          phone: profileForm.phone.trim() || null,
        }),
      });
      const updated = { ...customer, ...payload };
      writeCustomerSession(token, updated);
      setSession({ token, customer: updated });
      showMessage('success', 'Profile updated successfully.');
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('profile', false);
    }
  };

  const requestOtp = async () => {
    setLoading('otp', true);
    try {
      await fetchJson(`${AUTH}/me/request-otp`, { method: 'POST', headers });
      showMessage('success', hasLocalPassword ? `OTP sent to ${customer.email}` : `Setup OTP sent to ${customer.email}`);
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('otp', false);
    }
  };

  const setInitialPassword = async () => {
    setLoading('password', true);
    try {
      const payload = await fetchJson(`${AUTH}/me/password/set`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          new_password: passwordForm.new_password,
          otp_code: passwordForm.otp_code,
        }),
      });
      setPasswordForm({ current_password: '', new_password: '', otp_code: '' });
      if (payload.customer) {
        writeCustomerSession(token, payload.customer);
        setSession({ token, customer: payload.customer });
      }
      showMessage('success', payload.message || 'Password set successfully.');
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('password', false);
    }
  };

  const changePassword = async () => {
    if (!hasLocalPassword) {
      showMessage('danger', 'Set a local password before changing your password.');
      return;
    }
    setLoading('password', true);
    try {
      await fetchJson(`${AUTH}/me/password`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(passwordForm),
      });
      showMessage('success', 'Password changed. Logging out...');
      setTimeout(() => logout(), 1800);
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('password', false);
    }
  };

  const deleteAccount = async () => {
    if (!hasLocalPassword) {
      showMessage('danger', 'Set a local password before deleting this account.');
      return;
    }
    setLoading('delete', true);
    try {
      await fetchJson(`${AUTH}/me`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify(deleteForm),
      });
      showMessage('success', 'Account deleted. Redirecting...');
      setTimeout(() => logout(), 1500);
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('delete', false);
    }
  };

  if (!customer) {
    return html`<main className="app-shell"><div className="card"><div className="card-body">Loading customer session...</div></div></main>`;
  }

  return html`
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <img src="/assets/images/app-logo.png" alt="FTDS" style=${{ height: '22px', width: '22px', objectFit: 'contain', flexShrink: 0 }} />
          FTDS Banking
        </div>

        <div style=${{ position: 'relative' }}>
          <button className="profile-trigger" onClick=${() => setProfileOpen((o) => !o)}>
            <span className="profile-avatar">${(customer.full_name || 'U')[0].toUpperCase()}</span>
            <div className="profile-trigger-info">
              <span className="profile-trigger-name">${customer.full_name}</span>
              <span className="profile-trigger-sub">${customer.email}</span>
            </div>
            <span className="profile-caret">▾</span>
          </button>

          ${profileOpen ? html`
            <div className="profile-dropdown">
              <button className="profile-dropdown-item" onClick=${() => { setProfileOpen(false); setProfileModalOpen(true); }}>
                <span className="profile-dropdown-icon">👤</span>
                <span>Edit Profile</span>
              </button>
              <button className="profile-dropdown-item" onClick=${toggleUtc} style=${{ justifyContent: 'space-between' }}>
                <span style=${{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="profile-dropdown-icon">🕐</span>
                  <span>Show UTC time</span>
                </span>
                <span style=${{
                  display: 'inline-flex', alignItems: 'center', width: '2rem', height: '1.1rem',
                  background: showUtc ? 'var(--accent)' : 'var(--border)', borderRadius: '999px',
                  padding: '0.1rem', transition: 'background 0.2s', flexShrink: 0,
                }}>
                  <span style=${{
                    width: '0.85rem', height: '0.85rem', borderRadius: '50%', background: '#fff',
                    transform: showUtc ? 'translateX(0.9rem)' : 'translateX(0)',
                    transition: 'transform 0.2s',
                  }} />
                </span>
              </button>
              <button className="profile-dropdown-item profile-dropdown-item--danger" onClick=${logout}>
                <span className="profile-dropdown-icon">⎋</span>
                <span>Logout</span>
              </button>
            </div>
          ` : null}
        </div>
      </div>
    </header>

    ${txnDetail ? html`<${TxnDetailModal} txn=${txnDetail} fmtDate=${fmtDate} onClose=${() => setTxnDetail(null)} />` : null}

    ${profileModalOpen ? html`<${ProfileModal}
      customer=${customer}
      hasLocalPassword=${hasLocalPassword}
      profileForm=${profileForm}
      setProfileForm=${setProfileForm}
      passwordForm=${passwordForm}
      setPasswordForm=${setPasswordForm}
      deleteForm=${deleteForm}
      setDeleteForm=${setDeleteForm}
      busy=${busy}
      saveProfile=${saveProfile}
      requestOtp=${requestOtp}
      changePassword=${changePassword}
      setInitialPassword=${setInitialPassword}
      deleteAccount=${deleteAccount}
      onClose=${() => setProfileModalOpen(false)}
    />` : null}

    <main className="app-shell">
      <section className="hero">
        <span className="hero-chip">Customer Dashboard</span>
        <h1>Payments, decisions, and appeals</h1>
        <p>Create transactions, monitor fraud decisions, and submit appeals when needed.</p>
      </section>

      ${message.text ? html`<div className=${`alert alert-${message.type || 'success'}`} style=${{ marginTop: '1rem' }}>${message.text}</div>` : null}

      <section className="grid cols-2" style=${{ marginTop: '1rem' }}>
        <article className="card">
          <div className="card-head"><h2 className="title-sm">New Transaction</h2><div className="muted small">${showUtc ? 'UTC' : 'Local'} now: ${nowUtc}</div></div>
          <div className="card-body">
            <form className="grid" style=${{ gap: '0.75rem' }} onSubmit=${submitTransaction}>
              <div className="tabs">
                <button type="button" className=${`tab ${txnForm.recipientType === 'merchant' ? 'active' : ''}`} onClick=${() => { setTxnForm((p) => ({ ...p, recipientType: 'merchant' })); setRecipient(null); }}>Merchant</button>
                <button type="button" className=${`tab ${txnForm.recipientType === 'customer' ? 'active' : ''}`} onClick=${() => { setTxnForm((p) => ({ ...p, recipientType: 'customer' })); setRecipient(null); }}>Customer</button>
              </div>

              ${txnForm.recipientType === 'merchant' ? html`
                <div className="field"><label>Merchant ID / UEN</label><input className="input" value=${txnForm.merchantId} onInput=${(e) => setTxnForm((p) => ({ ...p, merchantId: e.target.value }))} /></div>
              ` : html`
                <div className="field">
                  <label>Recipient email</label>
                  <div className="row">
                    <input className="input" style=${{ flex: '1' }} value=${txnForm.recipientQuery} onInput=${(e) => setTxnForm((p) => ({ ...p, recipientQuery: e.target.value }))} />
                    <button type="button" className="btn btn-ghost" onClick=${lookupRecipient} disabled=${busy.lookup}>${busy.lookup ? 'Looking...' : 'Lookup'}</button>
                  </div>
                  ${recipient ? html`<div className="metric" style=${{ marginTop: '0.55rem' }}><div className="title-sm">${recipient.full_name}</div><div className="muted small">${recipient.email}</div></div>` : null}
                </div>
              `}

              <div className="grid cols-2">
                <div className="field"><label>Amount</label><input className="input" type="number" min="0.01" step="0.01" value=${txnForm.amount} onInput=${(e) => setTxnForm((p) => ({ ...p, amount: e.target.value }))} required /></div>
                <div className="field"><label>Currency</label><select className="select" value=${txnForm.currency} onChange=${(e) => setTxnForm((p) => ({ ...p, currency: e.target.value }))}>${currencies.map((c) => html`<option value=${c}>${c}</option>`)}</select></div>
              </div>
              <div className="grid cols-2">
                <div className="field"><label>Card type</label><select className="select" value=${txnForm.cardType} onChange=${(e) => setTxnForm((p) => ({ ...p, cardType: e.target.value }))}>${cardTypes.map((c) => html`<option value=${c}>${c}</option>`)}</select></div>
                <div className="field"><label>Country</label><select className="select" value=${txnForm.country} onChange=${(e) => setTxnForm((p) => ({ ...p, country: e.target.value }))}>${countries.map((c) => html`<option value=${c}>${c}</option>`)}</select></div>
              </div>
              <button className="btn btn-primary" type="submit" disabled=${busy.txn || !hasLocalPassword}>${busy.txn ? 'Submitting...' : 'Submit transaction'}</button>
              ${hasLocalPassword ? null : html`<div className="muted small">Set a local password first to unlock outgoing transactions and other customer actions.</div>`}
            </form>
          </div>
        </article>

        <article className="card">
          <div className="card-head row space-between">
            <h2 className="title-sm">Appeal Submission</h2>
            <button className="btn btn-ghost" onClick=${() => loadAppeals().catch(() => {})}>Refresh appeals</button>
          </div>
          <div className="card-body">
            ${!hasAppealable ? html`
              <div className="muted" style=${{ textAlign: 'center', padding: '1.5rem 0', fontSize: '0.9rem' }}>No transaction needed for appeal.</div>
            ` : html`
              <div className="field"><label>Selected transaction ID</label><input className="input mono" value=${appealDraft.transactionId} readonly /></div>
              <div className="field" style=${{ marginTop: '0.65rem' }}><label>Reason for appeal</label><textarea className="textarea" value=${appealDraft.reason} onInput=${(e) => setAppealDraft((p) => ({ ...p, reason: e.target.value }))}></textarea></div>
              <button className="btn btn-warning" style=${{ marginTop: '0.65rem' }} onClick=${submitAppeal} disabled=${busy.appeal || !hasLocalPassword || selectedTransactionAlreadyAppealed || !appealDraft.transactionId}>${busy.appeal ? 'Submitting...' : selectedTransactionAlreadyAppealed ? 'Appeal already submitted' : 'Submit appeal'}</button>
              ${selectedTransactionAlreadyAppealed
                ? html`<div className="muted small" style=${{ marginTop: '0.65rem' }}>An appeal already exists for this transaction, so it cannot be submitted again.</div>`
                : null}
              ${hasLocalPassword ? null : html`<div className="muted small" style=${{ marginTop: '0.65rem' }}>Set a local password first to unlock new appeals.</div>`}
              <div className="muted small" style=${{ marginTop: '0.65rem' }}>Tip: click "Appeal" from a transaction row to auto-fill the selected transaction ID.</div>
            `}
          </div>
        </article>
      </section>

      <section id="transactions" className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-head row space-between">
          <h2 className="title-sm">My Transactions</h2>
          <div className="row">
            <div className="tabs">${['all', 'outgoing', 'incoming'].map((v) => html`<button type="button" className=${`tab ${direction === v ? 'active' : ''}`} onClick=${() => setDirection(v)}>${v}</button>`)}</div>
            <button className="btn btn-ghost" onClick=${() => loadTransactions().catch(() => {})}>Refresh</button>
          </div>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Amount</th><th>Counterparty</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
              <tbody>
                ${transactions.length ? transactions.map((txn) => html`
                  <tr>
                    <td className="mono" style=${{ cursor: 'pointer', color: 'var(--accent)' }} onClick=${() => setTxnDetail(txn)}>${txn.transaction_id}</td>
                    <td>${formatMoney(txn.currency, txn.amount)}</td>
                    <td>${txn.recipient_name || txn.sender_name || txn.recipient_customer_id || txn.merchant_id || '-'}</td>
                    <td><span className=${`pill ${statusClass(txn.status)}`}>${txn.status}</span></td>
                    <td className="muted small mono">${fmtDate(txn.created_at)}</td>
                    <td>
                      ${['REJECTED'].includes(String(txn.status || '').toUpperCase())
                        ? !hasLocalPassword
                          ? html`<span className="muted small">Locked</span>`
                          : appealedTransactionIds.has(txn.transaction_id)
                          ? html`<span className="muted small">Appealed</span>`
                          : html`<button className="btn btn-ghost" onClick=${() => setAppealDraft((p) => ({ ...p, transactionId: txn.transaction_id }))}>Appeal</button>`
                        : html`<span className="muted small">-</span>`}
                    </td>
                  </tr>
                `) : html`<tr><td colspan="6" className="muted">No transactions found.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="appeals" className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-head"><h2 className="title-sm">My Appeals</h2></div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Appeal ID</th><th>Transaction</th><th>Status</th><th>Outcome</th><th>Reason</th><th>Submitted</th></tr></thead>
              <tbody>
                ${appeals.length ? appeals.map((a) => html`
                  <tr>
                    <td className="mono">${a.appealId}</td>
                    <td className="mono" style=${{ cursor: 'pointer', color: 'var(--accent)' }} onClick=${() => { const t = transactions.find((x) => x.transaction_id === a.transactionId); if (t) setTxnDetail(t); }}>${a.transactionId}</td>
                    <td><span className=${`pill ${statusClass(a.currentStatus)}`}>${a.currentStatus}</span></td>
                    <td>${a.resolution || '-'}</td>
                    <td>${a.resolutionNotes || a.appealReason || '-'}</td>
                    <td className="muted small">${fmtDate(a.createdAt)}</td>
                  </tr>
                `) : html`<tr><td colspan="6" className="muted">No appeals submitted yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </main>
  `;
};

mountApp('#app', App);

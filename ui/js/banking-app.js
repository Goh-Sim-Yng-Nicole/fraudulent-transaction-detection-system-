import {
  html,
  useState,
  useEffect,
  mountApp,
  API_ROOT,
  fetchJson,
  readCustomerSession,
  writeCustomerSession,
  clearCustomerSession,
  formatMoney,
  formatUtc,
} from './common.js';

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
const blankRecipientSaveForm = () => ({ nickname: '', isFavorite: false });

const normalizeSavedRecipient = (recipient = {}) => ({
  recipient_id: String(recipient.recipient_id || ''),
  owner_customer_id: recipient.owner_customer_id || '',
  recipient_customer_id: recipient.recipient_customer_id || '',
  recipient_name: recipient.recipient_name || '',
  recipient_email: recipient.recipient_email || '',
  nickname: recipient.nickname || '',
  is_favorite: Boolean(recipient.is_favorite ?? recipient.is_favourite),
  is_active: recipient.is_active !== false,
  created_on: recipient.created_on || null,
  updated_on: recipient.updated_on || null,
});

const sortSavedRecipients = (items) => {
  return [...items].sort((left, right) => {
    if (Boolean(left.is_favorite) !== Boolean(right.is_favorite)) {
      return Number(Boolean(right.is_favorite)) - Number(Boolean(left.is_favorite));
    }

    const leftLabel = String(left.nickname || left.recipient_name || '').toLowerCase();
    const rightLabel = String(right.nickname || right.recipient_name || '').toLowerCase();
    return leftLabel.localeCompare(rightLabel);
  });
};

const App = () => {
  const [session, setSession] = useState(null);
  const [direction, setDirection] = useState('all');
  const [transactions, setTransactions] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [savedRecipients, setSavedRecipients] = useState([]);
  const [selectedSavedRecipientId, setSelectedSavedRecipientId] = useState('');
  const [recipientSaveForm, setRecipientSaveForm] = useState(blankRecipientSaveForm());
  const [recipientDirectory, setRecipientDirectory] = useState({
    configured: true,
    initialized: false,
    error: '',
  });
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
  const [nowUtc, setNowUtc] = useState('');

  const token = session?.token || '';
  const customer = session?.customer || null;
  const headers = { Authorization: `Bearer ${token}` };
  const hasLocalPassword = customer?.has_password !== false;
  const appealedTransactionIds = new Set(appeals.map((appeal) => appeal.transaction_id));
  const selectedTransactionAlreadyAppealed = appealedTransactionIds.has(appealDraft.transactionId);
  const matchedSavedRecipient = recipient?.customer_id
    ? savedRecipients.find((item) => item.recipient_customer_id === recipient.customer_id)
    : null;

  const logout = () => {
    clearCustomerSession();
    window.location.href = '/index.html';
  };

  const setLoading = (key, value) => setBusy((prev) => ({ ...prev, [key]: value }));
  const showMessage = (type, text) => setMessage({ type, text });

  const syncCustomerProfile = async () => {
    if (!token) return;
    const payload = await fetchJson(`${API_ROOT}/customers/me`, { headers });
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
      `${API_ROOT}/customer/transactions?customer_id=${encodeURIComponent(customer.customer_id)}&direction=${encodeURIComponent(currentDirection)}`,
      { headers },
    );
    setTransactions(Array.isArray(payload) ? payload : []);
  };

  const loadAppeals = async () => {
    if (!customer) return;
    const payload = await fetchJson(
      `${API_ROOT}/customer/appeals?customer_id=${encodeURIComponent(customer.customer_id)}`,
      { headers },
    );
    setAppeals(Array.isArray(payload) ? payload : []);
  };

  const loadSavedRecipients = async ({ quiet = true } = {}) => {
    if (!token) return;
    setLoading('recipients', true);
    try {
      const payload = await fetchJson(`${API_ROOT}/customer/recipients`, { headers });
      const normalized = sortSavedRecipients(
        Array.isArray(payload) ? payload.map(normalizeSavedRecipient) : [],
      );
      setSavedRecipients(normalized);
      setRecipientDirectory({
        configured: true,
        initialized: true,
        error: '',
      });
    } catch (error) {
      const errorMessage = String(error.message || '');
      const unavailable = /saved recipients are not configured/i.test(errorMessage);
      setSavedRecipients([]);
      setRecipientDirectory({
        configured: !unavailable,
        initialized: true,
        error: unavailable ? '' : errorMessage,
      });
      if (!quiet && !unavailable) {
        showMessage('danger', errorMessage);
      }
    } finally {
      setLoading('recipients', false);
    }
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
    Promise.all([loadTransactions(direction), loadAppeals(), loadSavedRecipients()]).catch(() => {});
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!session) return;
    loadTransactions(direction).catch(() => {});
  }, [direction, session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => setNowUtc(formatUtc(new Date())), 1000);
    return () => clearInterval(id);
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
        `${API_ROOT}/customers/lookup?query=${encodeURIComponent(txnForm.recipientQuery.trim())}`,
        { headers },
      );
      setRecipient(payload);
      const existingSavedRecipient = savedRecipients.find(
        (item) => item.recipient_customer_id === payload.customer_id,
      );
      setSelectedSavedRecipientId(existingSavedRecipient?.recipient_id || '');
      setRecipientSaveForm({
        nickname: existingSavedRecipient?.nickname || payload.full_name || '',
        isFavorite: Boolean(existingSavedRecipient?.is_favorite),
      });
      showMessage(
        'success',
        existingSavedRecipient
          ? `Recipient found: ${payload.full_name}. This recipient is already saved in your directory.`
          : `Recipient found: ${payload.full_name}`,
      );
    } catch (error) {
      showMessage('danger', error.message);
      setRecipient(null);
      setSelectedSavedRecipientId('');
      setRecipientSaveForm(blankRecipientSaveForm());
    } finally {
      setLoading('lookup', false);
    }
  };

  const useSavedRecipient = (savedRecipient) => {
    setTxnForm((prev) => ({
      ...prev,
      recipientType: 'customer',
      recipientQuery: savedRecipient.recipient_email,
    }));
    setRecipient({
      customer_id: savedRecipient.recipient_customer_id,
      full_name: savedRecipient.recipient_name,
      email: savedRecipient.recipient_email,
    });
    setSelectedSavedRecipientId(savedRecipient.recipient_id);
    setRecipientSaveForm({
      nickname: savedRecipient.nickname || savedRecipient.recipient_name,
      isFavorite: Boolean(savedRecipient.is_favorite),
    });
    showMessage('success', `Using saved recipient: ${savedRecipient.nickname || savedRecipient.recipient_name}`);
  };

  const upsertSavedRecipient = (savedRecipient) => {
    setSavedRecipients((previous) => {
      const next = previous.some((item) => item.recipient_id === savedRecipient.recipient_id)
        ? previous.map((item) => (item.recipient_id === savedRecipient.recipient_id ? savedRecipient : item))
        : [...previous, savedRecipient];
      return sortSavedRecipients(next);
    });
  };

  const saveRecipient = async () => {
    if (!recipient?.customer_id) {
      showMessage('danger', 'Look up a recipient first before saving them.');
      return;
    }

    setLoading('saveRecipient', true);
    try {
      const existingSavedRecipient = savedRecipients.find(
        (item) => item.recipient_customer_id === recipient.customer_id,
      );
      const payload = await fetchJson(
        existingSavedRecipient
          ? `${API_ROOT}/customer/recipients/${encodeURIComponent(existingSavedRecipient.recipient_id)}`
          : `${API_ROOT}/customer/recipients`,
        {
          method: existingSavedRecipient ? 'PUT' : 'POST',
          headers,
          body: JSON.stringify(
            existingSavedRecipient
              ? {
                nickname: recipientSaveForm.nickname.trim() || recipient.full_name,
                is_favorite: recipientSaveForm.isFavorite,
              }
              : {
                recipient_customer_id: recipient.customer_id,
                recipient_name: recipient.full_name,
                recipient_email: recipient.email,
                nickname: recipientSaveForm.nickname.trim() || recipient.full_name,
                is_favorite: recipientSaveForm.isFavorite,
              },
          ),
        },
      );
      const normalized = normalizeSavedRecipient(payload);
      upsertSavedRecipient(normalized);
      setSelectedSavedRecipientId(normalized.recipient_id);
      setRecipientSaveForm({
        nickname: normalized.nickname || normalized.recipient_name,
        isFavorite: Boolean(normalized.is_favorite),
      });
      showMessage(
        'success',
        existingSavedRecipient
          ? 'Saved recipient updated successfully.'
          : 'Recipient saved for quicker future transfers.',
      );
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('saveRecipient', false);
    }
  };

  const updateSavedRecipientFavorite = async (savedRecipient) => {
    setLoading('favoriteRecipient', savedRecipient.recipient_id);
    try {
      const payload = await fetchJson(
        `${API_ROOT}/customer/recipients/${encodeURIComponent(savedRecipient.recipient_id)}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            nickname: savedRecipient.nickname || savedRecipient.recipient_name,
            is_favorite: !savedRecipient.is_favorite,
          }),
        },
      );
      const normalized = normalizeSavedRecipient(payload);
      upsertSavedRecipient(normalized);
      if (selectedSavedRecipientId === normalized.recipient_id) {
        setRecipientSaveForm({
          nickname: normalized.nickname || normalized.recipient_name,
          isFavorite: Boolean(normalized.is_favorite),
        });
      }
      showMessage('success', normalized.is_favorite ? 'Recipient marked as favourite.' : 'Recipient removed from favourites.');
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('favoriteRecipient', '');
    }
  };

  const deleteSavedRecipient = async (savedRecipient) => {
    if (!window.confirm(`Remove ${savedRecipient.nickname || savedRecipient.recipient_name} from saved recipients?`)) {
      return;
    }

    setLoading('deleteRecipient', savedRecipient.recipient_id);
    try {
      await fetchJson(
        `${API_ROOT}/customer/recipients/${encodeURIComponent(savedRecipient.recipient_id)}`,
        {
          method: 'DELETE',
          headers,
        },
      );
      setSavedRecipients((previous) => previous.filter((item) => item.recipient_id !== savedRecipient.recipient_id));
      if (selectedSavedRecipientId === savedRecipient.recipient_id) {
        setSelectedSavedRecipientId('');
        setRecipient(null);
        setRecipientSaveForm(blankRecipientSaveForm());
        setTxnForm((prev) => ({ ...prev, recipientQuery: '' }));
      }
      showMessage('success', 'Saved recipient removed.');
    } catch (error) {
      showMessage('danger', error.message);
    } finally {
      setLoading('deleteRecipient', '');
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

      const payload = await fetchJson(`${API_ROOT}/customer/transactions`, {
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
      await fetchJson(`${API_ROOT}/customer/appeals`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transaction_id: appealDraft.transactionId,
          reason_for_appeal: appealDraft.reason.trim(),
          customer_id: customer.customer_id,
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
      const payload = await fetchJson(`${API_ROOT}/customers/me`, {
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
      await fetchJson(`${API_ROOT}/customers/me/request-otp`, { method: 'POST', headers });
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
      const payload = await fetchJson(`${API_ROOT}/customers/me/password/set`, {
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
      await fetchJson(`${API_ROOT}/customers/me/password`, {
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
      await fetchJson(`${API_ROOT}/customers/me`, {
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
        <div className="brand"><span className="brand-dot"></span>FTDS Banking</div>
        <div className="row">
          <span className="badge">${customer.full_name}</span>
          <span className="badge">${customer.email}</span>
          <button className="btn btn-ghost" onClick=${logout}>Logout</button>
        </div>
      </div>
    </header>

    <main className="app-shell">
      <section className="hero">
        <span className="hero-chip">Customer Dashboard</span>
        <h1>Payments, decisions, and appeals</h1>
        <p>Create transactions, monitor fraud decisions, and submit appeals when needed.</p>
      </section>

      ${message.text ? html`<div className=${`alert alert-${message.type || 'success'}`} style=${{ marginTop: '1rem' }}>${message.text}</div>` : null}

      <section className="grid cols-2" style=${{ marginTop: '1rem' }}>
        <article className="card">
          <div className="card-head"><h2 className="title-sm">New Transaction</h2><div className="muted small">UTC now: ${nowUtc}</div></div>
          <div className="card-body">
            <form className="grid" style=${{ gap: '0.75rem' }} onSubmit=${submitTransaction}>
              <div className="tabs">
                <button type="button" className=${`tab ${txnForm.recipientType === 'merchant' ? 'active' : ''}`} onClick=${() => {
                  setTxnForm((p) => ({ ...p, recipientType: 'merchant' }));
                  setRecipient(null);
                  setSelectedSavedRecipientId('');
                }}>Merchant</button>
                <button type="button" className=${`tab ${txnForm.recipientType === 'customer' ? 'active' : ''}`} onClick=${() => {
                  setTxnForm((p) => ({ ...p, recipientType: 'customer' }));
                  setRecipient(null);
                  setSelectedSavedRecipientId('');
                }}>Customer</button>
              </div>

              ${txnForm.recipientType === 'merchant' ? html`
                <div className="field"><label>Merchant ID / UEN</label><input className="input" value=${txnForm.merchantId} onInput=${(e) => setTxnForm((p) => ({ ...p, merchantId: e.target.value }))} /></div>
              ` : html`
                <div className="field">
                  <div className="row space-between">
                    <label>Saved recipients</label>
                    ${recipientDirectory.configured ? html`
                      <button type="button" className="btn btn-ghost" onClick=${() => loadSavedRecipients({ quiet: false })} disabled=${busy.recipients}>
                        ${busy.recipients ? 'Refreshing...' : 'Refresh directory'}
                      </button>
                    ` : null}
                  </div>
                  ${recipientDirectory.configured ? html`
                    ${savedRecipients.length ? html`
                      <div className="recipient-directory">
                        ${savedRecipients.map((savedRecipient) => html`
                          <div className=${`recipient-entry ${selectedSavedRecipientId === savedRecipient.recipient_id ? 'active' : ''}`}>
                            <div>
                              <div className="title-sm">${savedRecipient.nickname || savedRecipient.recipient_name}</div>
                              <div className="muted small">${savedRecipient.recipient_name} · ${savedRecipient.recipient_email}</div>
                            </div>
                            <div className="row recipient-actions">
                              ${savedRecipient.is_favorite ? html`<span className="pill status-approved">Favourite</span>` : null}
                              <button type="button" className="btn btn-ghost" onClick=${() => useSavedRecipient(savedRecipient)}>Use</button>
                              <button type="button" className="btn btn-ghost" onClick=${() => updateSavedRecipientFavorite(savedRecipient)} disabled=${busy.favoriteRecipient === savedRecipient.recipient_id}>
                                ${busy.favoriteRecipient === savedRecipient.recipient_id ? 'Saving...' : savedRecipient.is_favorite ? 'Unfavourite' : 'Favourite'}
                              </button>
                              <button type="button" className="btn btn-danger" onClick=${() => deleteSavedRecipient(savedRecipient)} disabled=${busy.deleteRecipient === savedRecipient.recipient_id}>
                                ${busy.deleteRecipient === savedRecipient.recipient_id ? 'Removing...' : 'Remove'}
                              </button>
                            </div>
                          </div>
                        `)}
                      </div>
                    ` : html`<div className="muted small">No saved recipients yet. Look up a validated customer below and save them for faster future transfers.</div>`}
                  ` : html`
                    <div className="muted small">Saved recipients are not available in this environment yet. You can still use live lookup for customer transfers.</div>
                  `}
                  ${recipientDirectory.error ? html`<div className="muted small" style=${{ marginTop: '0.45rem' }}>${recipientDirectory.error}</div>` : null}
                </div>
                <div className="field">
                  <label>Recipient email</label>
                  <div className="row">
                    <input className="input" style=${{ flex: '1' }} value=${txnForm.recipientQuery} onInput=${(e) => {
                      setTxnForm((p) => ({ ...p, recipientQuery: e.target.value }));
                      setRecipient(null);
                      setSelectedSavedRecipientId('');
                    }} />
                    <button type="button" className="btn btn-ghost" onClick=${lookupRecipient} disabled=${busy.lookup}>${busy.lookup ? 'Looking...' : 'Lookup'}</button>
                  </div>
                  ${recipient ? html`
                    <div className="metric" style=${{ marginTop: '0.55rem' }}>
                      <div className="title-sm">${recipient.full_name}</div>
                      <div className="muted small">${recipient.email}</div>
                      <div className="muted small" style=${{ marginTop: '0.35rem' }}>
                        ${matchedSavedRecipient ? 'Already saved in your recipient directory.' : 'Validated via live customer lookup.'}
                      </div>
                    </div>
                  ` : null}
                  ${recipient && recipientDirectory.configured ? html`
                    <div className="grid cols-2" style=${{ marginTop: '0.75rem' }}>
                      <div className="field">
                        <label>Saved nickname</label>
                        <input
                          className="input"
                          value=${recipientSaveForm.nickname}
                          onInput=${(e) => setRecipientSaveForm((prev) => ({ ...prev, nickname: e.target.value }))}
                          placeholder="How should this recipient appear in your directory?"
                        />
                      </div>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked=${recipientSaveForm.isFavorite}
                          onChange=${(e) => setRecipientSaveForm((prev) => ({ ...prev, isFavorite: e.target.checked }))}
                        />
                        <span>Mark as favourite</span>
                      </label>
                    </div>
                  ` : null}
                  ${recipient && recipientDirectory.configured ? html`
                    <div className="row" style=${{ marginTop: '0.6rem' }}>
                      <button type="button" className="btn btn-success" onClick=${saveRecipient} disabled=${busy.saveRecipient || !hasLocalPassword}>
                        ${busy.saveRecipient ? 'Saving...' : matchedSavedRecipient ? 'Update saved recipient' : 'Save recipient'}
                      </button>
                      ${hasLocalPassword ? null : html`<span className="muted small">Set a local password first to manage saved recipients.</span>`}
                    </div>
                  ` : null}
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

        ${transactions.length ? html`
          <article className="card">
            <div className="card-head row space-between">
              <h2 className="title-sm">Appeal Submission</h2>
              <button className="btn btn-ghost" onClick=${() => loadAppeals().catch(() => {})}>Refresh appeals</button>
            </div>
            <div className="card-body">
              <div className="field"><label>Selected transaction ID</label><input className="input mono" value=${appealDraft.transactionId} readonly /></div>
              <div className="field" style=${{ marginTop: '0.65rem' }}><label>Reason for appeal</label><textarea className="textarea" value=${appealDraft.reason} onInput=${(e) => setAppealDraft((p) => ({ ...p, reason: e.target.value }))}></textarea></div>
              <button className="btn btn-warning" style=${{ marginTop: '0.65rem' }} onClick=${submitAppeal} disabled=${busy.appeal || !hasLocalPassword || selectedTransactionAlreadyAppealed || !appealDraft.transactionId}>${busy.appeal ? 'Submitting...' : selectedTransactionAlreadyAppealed ? 'Appeal already submitted' : 'Submit appeal'}</button>
              ${selectedTransactionAlreadyAppealed
                ? html`<div className="muted small" style=${{ marginTop: '0.65rem' }}>An appeal already exists for this transaction, so it cannot be submitted again.</div>`
                : null}
              ${hasLocalPassword ? null : html`<div className="muted small" style=${{ marginTop: '0.65rem' }}>Set a local password first to unlock new appeals.</div>`}
              <div className="muted small" style=${{ marginTop: '0.65rem' }}>Tip: click "Appeal" from a transaction row to auto-fill the selected transaction ID.</div>
            </div>
          </article>
        ` : null}
      </section>

      <section className="card" style=${{ marginTop: '1rem' }}>
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
              <thead><tr><th>ID</th><th>Amount</th><th>Counterparty</th><th>Status</th><th>Risk</th><th>Date (UTC)</th><th>Action</th></tr></thead>
              <tbody>
                ${transactions.length ? transactions.map((txn) => html`
                  <tr>
                    <td className="mono">${txn.transaction_id}</td>
                    <td>${formatMoney(txn.currency, txn.amount)}</td>
                    <td>${txn.recipient_name || txn.sender_name || txn.recipient_customer_id || txn.merchant_id || '-'}</td>
                    <td><span className=${`pill ${statusClass(txn.status)}`}>${txn.status}</span></td>
                    <td>${txn.fraud_score == null ? '-' : `${txn.fraud_score}/100`}</td>
                    <td className="muted small mono">${formatUtc(txn.created_at)}</td>
                    <td>
                      ${['FLAGGED', 'REJECTED'].includes(String(txn.status || '').toUpperCase())
                        ? !hasLocalPassword
                          ? html`<span className="muted small">Locked</span>`
                          : appealedTransactionIds.has(txn.transaction_id)
                          ? html`<span className="muted small">Appealed</span>`
                          : html`<button className="btn btn-ghost" onClick=${() => setAppealDraft((p) => ({ ...p, transactionId: txn.transaction_id }))}>Appeal</button>`
                        : html`<span className="muted small">-</span>`}
                    </td>
                  </tr>
                `) : html`<tr><td colspan="7" className="muted">No transactions found.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card" style=${{ marginTop: '1rem' }}>
        <div className="card-head"><h2 className="title-sm">My Appeals</h2></div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Appeal ID</th><th>Transaction</th><th>Status</th><th>Outcome</th><th>Reason</th><th>Submitted</th></tr></thead>
              <tbody>
                ${appeals.length ? appeals.map((a) => html`
                  <tr>
                    <td className="mono">${a.appeal_id}</td>
                    <td className="mono">${a.transaction_id}</td>
                    <td><span className=${`pill ${statusClass(a.status)}`}>${a.status}</span></td>
                    <td>${a.manual_outcome || '-'}</td>
                    <td>${a.outcome_reason || '-'}</td>
                    <td className="muted small">${new Date(a.created_at).toLocaleString()}</td>
                  </tr>
                `) : html`<tr><td colspan="6" className="muted">No appeals submitted yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid cols-2" style=${{ marginTop: '1rem' }}>
        <article className="card">
          <div className="card-head"><h2 className="title-sm">Profile & Password</h2></div>
          <div className="card-body grid" style=${{ gap: '0.65rem' }}>
            ${hasLocalPassword ? null : html`<div className="alert alert-warning">This account has no local password yet. Set one first to unlock profile changes and account deletion.</div>`}
            <div className="field"><label>Full name</label><input className="input" value=${profileForm.full_name} onInput=${(e) => setProfileForm((p) => ({ ...p, full_name: e.target.value }))} /></div>
            <div className="field"><label>Email</label><input className="input" value=${profileForm.email} readonly /></div>
            <div className="field"><label>Phone</label><input className="input" value=${profileForm.phone} onInput=${(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} /></div>
            <button className="btn btn-primary" onClick=${saveProfile} disabled=${busy.profile || !hasLocalPassword}>${busy.profile ? 'Saving...' : 'Save profile'}</button>
            <div className="row"><button className="btn btn-ghost" onClick=${requestOtp} disabled=${busy.otp}>${busy.otp ? 'Sending OTP...' : hasLocalPassword ? 'Request OTP' : 'Request setup OTP'}</button></div>
            ${hasLocalPassword ? html`<div className="field"><label>Current password</label><input className="input" type="password" value=${passwordForm.current_password} onInput=${(e) => setPasswordForm((p) => ({ ...p, current_password: e.target.value }))} /></div>` : null}
            <div className="field"><label>New password</label><input className="input" type="password" value=${passwordForm.new_password} onInput=${(e) => setPasswordForm((p) => ({ ...p, new_password: e.target.value }))} /></div>
            <div className="field"><label>Email OTP</label><input className="input mono" value=${passwordForm.otp_code} onInput=${(e) => setPasswordForm((p) => ({ ...p, otp_code: e.target.value }))} /></div>
            <button className="btn btn-primary" onClick=${hasLocalPassword ? changePassword : setInitialPassword} disabled=${busy.password}>${busy.password ? (hasLocalPassword ? 'Changing...' : 'Setting...') : (hasLocalPassword ? 'Change password' : 'Set password')}</button>
          </div>
        </article>

        <article className="card">
          <div className="card-head"><h2 className="title-sm">Delete Account</h2></div>
          <div className="card-body grid" style=${{ gap: '0.65rem' }}>
            <div className="alert alert-warning">${hasLocalPassword ? 'This action is irreversible. Your account will be deactivated immediately.' : 'Set a local password first before deleting this account.'}</div>
            ${hasLocalPassword ? html`
              <div className="field"><label>Password</label><input className="input" type="password" value=${deleteForm.password} onInput=${(e) => setDeleteForm((p) => ({ ...p, password: e.target.value }))} /></div>
              <div className="field"><label>Email OTP</label><input className="input mono" value=${deleteForm.otp_code} onInput=${(e) => setDeleteForm((p) => ({ ...p, otp_code: e.target.value }))} /></div>
            ` : html`
              <div className="muted small">Request the setup OTP from the profile card, set a local password, then come back here if you still want to close the account.</div>
            `}
            <button className="btn btn-danger" onClick=${deleteAccount} disabled=${busy.delete || !hasLocalPassword}>${busy.delete ? 'Deleting...' : 'Delete account'}</button>
          </div>
        </article>
      </section>
    </main>
  `;
};

mountApp('#app', App);

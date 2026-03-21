const reviewRows = document.getElementById('reviewRows');
const appealRows = document.getElementById('appealRows');
const refreshBtn = document.getElementById('refreshBtn');
const reviewerInput = document.getElementById('reviewerInput');
const filterInput = document.getElementById('filterInput');
const clearFilterBtn = document.getElementById('clearFilterBtn');
const autoRefreshInput = document.getElementById('autoRefreshInput');
const rowTemplate = document.getElementById('rowTemplate');
const appealRowTemplate = document.getElementById('appealRowTemplate');
const statusFilterGroup = document.getElementById('statusFilterGroup');
const statusFilterButtons = statusFilterGroup ? [...statusFilterGroup.querySelectorAll('[data-queue-filter]')] : [];
const appealStatusFilterGroup = document.getElementById('appealStatusFilterGroup');
const appealStatusFilterButtons = appealStatusFilterGroup ? [...appealStatusFilterGroup.querySelectorAll('[data-appeal-filter]')] : [];

const pendingReviewCount = document.getElementById('pendingReviewCount');
const pendingAppealCount = document.getElementById('pendingAppealCount');
const visibleCount = document.getElementById('visibleCount');
const dataAvailability = document.getElementById('dataAvailability');
const dataHint = document.getElementById('dataHint');
const activeReviewer = document.getElementById('activeReviewer');

const API_BASE = window.location.pathname.startsWith('/human-verification')
  ? '/human-verification/api/v1'
  : '/api/v1';
const REFRESH_INTERVAL_MS = 15000;

let latestReviews = [];
let latestAppeals = [];
let poller = null;
let activeQueueFilter = 'ALL';
let activeAppealFilter = 'ALL';

const setStatus = (message, isError = false) => {
  if (!message) return;
  if (isError) {
    console.error(message);
    alert(message);
    return;
  }
  console.info(message);
};

const currentReviewer = () => reviewerInput.value.trim();

const updateDataStats = (reviewCount, appealCount, visibleReviewRows) => {
  pendingReviewCount.textContent = reviewCount;
  pendingAppealCount.textContent = appealCount;
  visibleCount.textContent = visibleReviewRows;

  if (reviewCount > 0 || appealCount > 0) {
    dataAvailability.textContent = 'YES';
    dataHint.textContent = `${reviewCount} review(s), ${appealCount} appeal(s) ready`;
  } else {
    dataAvailability.textContent = 'NO';
    dataHint.textContent = 'Waiting for pending items';
  }
};

const updateFilterUI = () => {
  clearFilterBtn.disabled = !filterInput.value.trim();
};

const updateQueueFilterUI = () => {
  statusFilterButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.queueFilter === activeQueueFilter);
  });
};

const updateAppealFilterUI = () => {
  appealStatusFilterButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.appealFilter === activeAppealFilter);
  });
};

const normalizeStatus = (status) => String(status || '').trim().toUpperCase().replace(/\s+/g, '_');

const toTitleCase = (status) => normalizeStatus(status).split('_')
  .filter(Boolean)
  .map((token) => token.charAt(0) + token.slice(1).toLowerCase())
  .join(' ');

const renderStatusPill = (status) => {
  const normalized = normalizeStatus(status) || 'UNKNOWN';
  const css = normalized.toLowerCase().replace(/_/g, '-');
  return `<span class="status-pill status-${css}">${toTitleCase(normalized)}</span>`;
};

const parseAmount = (row) => {
  const payload = row.payload || {};
  const amount = payload.amount ?? payload.originalTransaction?.amount ?? null;
  const currency = payload.currency || payload.originalTransaction?.currency || 'USD';

  if (amount === null || Number.isNaN(Number(amount))) {
    return '-';
  }

  return `${currency} ${Number(amount).toFixed(2)}`;
};

const assigneeLabel = (row) => {
  if (!row.claimedBy) return '-';
  const mine = row.claimedBy === currentReviewer();
  return mine ? `${row.claimedBy} (you)` : row.claimedBy;
};

const mapRow = (row) => ({
  transactionId: row.transactionId,
  customerId: row.customerId || '-',
  merchantId: row.merchantId || '-',
  amount: parseAmount(row),
  riskScore: row.riskScore ?? '-',
  reason: row.decisionReason || '-',
  queueStatus: row.queueStatus || 'PENDING',
  claimedBy: row.claimedBy || '',
  claimExpiresAt: row.claimExpiresAt || null,
  searchable: [row.transactionId, row.customerId, row.merchantId, row.decisionReason, row.queueStatus, row.claimedBy]
    .filter(Boolean)
    .join(' ')
    .toLowerCase(),
});

const mapAppealRow = (row) => ({
  appealId: row.appealId,
  transactionId: row.transactionId || '-',
  customerId: row.customerId || '-',
  sourceTransactionStatus: row.sourceTransactionStatus || '-',
  appealReason: row.appealReason || '-',
  currentStatus: row.currentStatus || 'OPEN',
  searchable: [
    row.appealId,
    row.transactionId,
    row.customerId,
    row.sourceTransactionStatus,
    row.appealReason,
    row.currentStatus,
  ].filter(Boolean).join(' ').toLowerCase(),
});

const disableRowButtons = (row, disabled) => {
  row.querySelectorAll('button').forEach((button) => {
    button.disabled = disabled;
  });
};

const disableAppealButtons = (row, disabled) => {
  row.querySelectorAll('[data-resolution]').forEach((button) => {
    button.disabled = disabled;
  });
};

const parseError = async (response) => {
  const payload = await response.json().catch(() => ({}));
  return payload.error || `Failed with status ${response.status}`;
};

const submitClaim = async (transactionId) => {
  const reviewerId = currentReviewer();
  if (!reviewerId) throw new Error('Please enter reviewer name before claiming.');

  const response = await fetch(`${API_BASE}/review-cases/${encodeURIComponent(transactionId)}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId, claimTtlMinutes: 10 }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  await refreshAllQueues();
};

const submitRelease = async (transactionId, notes) => {
  const reviewerId = currentReviewer();
  if (!reviewerId) throw new Error('Please enter reviewer name before release.');

  const response = await fetch(`${API_BASE}/review-cases/${encodeURIComponent(transactionId)}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId, notes }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  await refreshAllQueues();
};

const submitDecision = async ({ transactionId, decision, notes }) => {
  const reviewedBy = currentReviewer();
  if (!reviewedBy) {
    throw new Error('Please enter reviewer name before submitting decisions.');
  }

  const response = await fetch(`${API_BASE}/review-cases/${encodeURIComponent(transactionId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision,
      reviewedBy,
      notes: notes || `Set from dashboard at ${new Date().toISOString()}`,
    }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  await refreshAllQueues();
};

const submitAppealResolution = async ({ appealId, resolution, notes }) => {
  const reviewedBy = currentReviewer();
  if (!reviewedBy) {
    throw new Error('Please enter reviewer name before resolving appeals.');
  }

  const response = await fetch(`${API_BASE}/reviews/appeals/${encodeURIComponent(appealId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resolution,
      reviewedBy,
      notes: notes || `Appeal resolved from dashboard at ${new Date().toISOString()}`,
    }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  await refreshAllQueues();
};

const buildRow = (review) => {
  const mapped = mapRow(review);
  const fragment = rowTemplate.content.cloneNode(true);
  const row = fragment.querySelector('tr');

  row.querySelector('[data-col="transactionId"]').textContent = mapped.transactionId;
  row.querySelector('[data-col="customerId"]').textContent = mapped.customerId;
  row.querySelector('[data-col="merchantId"]').textContent = mapped.merchantId;
  row.querySelector('[data-col="amount"]').textContent = mapped.amount;
  row.querySelector('[data-col="riskScore"]').textContent = mapped.riskScore;
  row.querySelector('[data-col="reason"]').textContent = mapped.reason;
  row.querySelector('[data-col="queueStatus"]').innerHTML = renderStatusPill(mapped.queueStatus);
  row.querySelector('[data-col="assignee"]').textContent = assigneeLabel(mapped);

  const notesInput = row.querySelector('[data-input="notes"]');
  const claimBtn = row.querySelector('[data-action="claim"]');
  const releaseBtn = row.querySelector('[data-action="release"]');
  const decisionButtons = [...row.querySelectorAll('[data-decision]')];

  const mine = mapped.claimedBy && mapped.claimedBy === currentReviewer();
  const inReview = normalizeStatus(mapped.queueStatus) === 'IN_REVIEW';

  decisionButtons.forEach((button) => {
    button.disabled = !(mine && inReview);
  });

  claimBtn.disabled = mine || (inReview && mapped.claimedBy && !mine);
  releaseBtn.disabled = !mine;

  claimBtn.addEventListener('click', async () => {
    disableRowButtons(row, true);
    try {
      await submitClaim(mapped.transactionId);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      disableRowButtons(row, false);
    }
  });

  releaseBtn.addEventListener('click', async () => {
    disableRowButtons(row, true);
    try {
      await submitRelease(mapped.transactionId, notesInput.value.trim());
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      disableRowButtons(row, false);
    }
  });

  decisionButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      disableRowButtons(row, true);
      try {
        await submitDecision({
          transactionId: mapped.transactionId,
          decision: button.dataset.decision,
          notes: notesInput.value.trim(),
        });
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        disableRowButtons(row, false);
      }
    });
  });

  return fragment;
};

const buildAppealRow = (appeal) => {
  const mapped = mapAppealRow(appeal);
  const fragment = appealRowTemplate.content.cloneNode(true);
  const row = fragment.querySelector('tr');

  row.querySelector('[data-col="appealId"]').textContent = mapped.appealId;
  row.querySelector('[data-col="transactionId"]').textContent = mapped.transactionId;
  row.querySelector('[data-col="customerId"]').textContent = mapped.customerId;
  row.querySelector('[data-col="sourceTransactionStatus"]').innerHTML = renderStatusPill(mapped.sourceTransactionStatus);
  row.querySelector('[data-col="appealReason"]').textContent = mapped.appealReason;
  row.querySelector('[data-col="currentStatus"]').innerHTML = renderStatusPill(mapped.currentStatus);

  const notesInput = row.querySelector('[data-input="notes"]');

  row.querySelectorAll('[data-resolution]').forEach((button) => {
    button.addEventListener('click', async () => {
      disableAppealButtons(row, true);
      try {
        await submitAppealResolution({
          appealId: mapped.appealId,
          resolution: button.dataset.resolution,
          notes: notesInput.value.trim(),
        });
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        disableAppealButtons(row, false);
      }
    });
  });

  return fragment;
};

const renderRows = (reviews) => {
  reviewRows.innerHTML = '';

  if (!reviews.length) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="10" class="empty-state-cell">
        <div class="status-line">Loaded ${latestReviews.length} review item(s).</div>
        <div class="empty-line">No review items matching filters.</div>
      </td>
    `;
    reviewRows.appendChild(row);
    updateDataStats(latestReviews.length, latestAppeals.length, 0);
    return;
  }

  reviews.forEach((review) => reviewRows.appendChild(buildRow(review)));
  updateDataStats(latestReviews.length, latestAppeals.length, reviews.length);
};

const renderAppealRows = (appeals) => {
  appealRows.innerHTML = '';

  if (!appeals.length) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td colspan="8" class="empty-state-cell">
        <div class="status-line">Loaded ${latestAppeals.length} pending appeal(s).</div>
        <div class="empty-line">No pending appeals right now.</div>
      </td>
    `;
    appealRows.appendChild(row);
    return;
  }

  appeals.forEach((appeal) => appealRows.appendChild(buildAppealRow(appeal)));
};

const applyFilters = () => {
  const keyword = filterInput.value.trim().toLowerCase();
  updateFilterUI();
  updateQueueFilterUI();
  updateAppealFilterUI();

  const filteredReviews = latestReviews.filter((row) => {
    const mapped = mapRow(row);
    const matchesKeyword = !keyword || mapped.searchable.includes(keyword);
    const matchesStatus = activeQueueFilter === 'ALL' || normalizeStatus(mapped.queueStatus) === activeQueueFilter;
    return matchesKeyword && matchesStatus;
  });

  const filteredAppeals = latestAppeals.filter((row) => {
    const mapped = mapAppealRow(row);
    const matchesKeyword = !keyword || mapped.searchable.includes(keyword);
    const matchesStatus = activeAppealFilter === 'ALL' || normalizeStatus(mapped.currentStatus) === activeAppealFilter;
    return matchesKeyword && matchesStatus;
  });

  renderRows(filteredReviews);
  renderAppealRows(filteredAppeals);
};

const loadPendingReviews = async () => {
  const response = await fetch(`${API_BASE}/review-cases?status=PENDING,IN_REVIEW&limit=50&offset=0`);
  if (!response.ok) throw new Error(`Unable to load reviews (status ${response.status})`);

  const payload = await response.json();
  latestReviews = payload?.data || [];
};

const loadPendingAppeals = async () => {
  const response = await fetch(`${API_BASE}/reviews/appeals/pending?limit=50&offset=0`);
  if (!response.ok) throw new Error(`Unable to load appeals (status ${response.status})`);

  const payload = await response.json();
  latestAppeals = payload?.data || [];
};

const refreshAllQueues = async () => {
  await Promise.all([loadPendingReviews(), loadPendingAppeals()]);
  applyFilters();
};

const startPolling = () => {
  if (poller) clearInterval(poller);
  if (!autoRefreshInput.checked) return;

  poller = setInterval(async () => {
    try {
      await refreshAllQueues();
    } catch (error) {
      setStatus(error.message, true);
    }
  }, REFRESH_INTERVAL_MS);
};

refreshBtn.addEventListener('click', async () => {
  activeReviewer.textContent = currentReviewer() || 'Not set';
  try {
    await refreshAllQueues();
  } catch (error) {
    setStatus(error.message, true);
  }
});

filterInput.addEventListener('input', applyFilters);
clearFilterBtn.addEventListener('click', () => {
  filterInput.value = '';
  applyFilters();
  filterInput.focus();
});
autoRefreshInput.addEventListener('change', startPolling);

statusFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeQueueFilter = button.dataset.queueFilter || 'ALL';
    applyFilters();
  });
});

appealStatusFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeAppealFilter = button.dataset.appealFilter || 'ALL';
    applyFilters();
  });
});

reviewerInput.addEventListener('input', () => {
  activeReviewer.textContent = currentReviewer() || 'Not set';
  applyFilters();
});

activeReviewer.textContent = currentReviewer() || 'Not set';
updateFilterUI();
updateQueueFilterUI();
updateAppealFilterUI();
refreshAllQueues()
  .then(startPolling)
  .catch((error) => {
    setStatus(error.message, true);
  });

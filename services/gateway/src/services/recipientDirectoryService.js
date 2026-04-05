const axios = require('axios');
const config = require('../config');

const normalizeBoolean = (value) => Boolean(value);

const normalizeRecipient = (recipient = {}) => ({
  recipient_id: String(recipient.recipient_id ?? ''),
  owner_customer_id: recipient.owner_customer_id || '',
  recipient_customer_id: recipient.recipient_customer_id || '',
  recipient_name: recipient.recipient_name || '',
  recipient_email: recipient.recipient_email || '',
  nickname: recipient.nickname || '',
  is_favorite: normalizeBoolean(recipient.is_favourite ?? recipient.is_favorite),
  is_active: recipient.is_active !== false,
  created_on: recipient.created_on || null,
  updated_on: recipient.updated_on || null,
});

const normalizeErrorPayload = (payload, status) => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload;
  }

  if (typeof payload === 'string' && payload.trim()) {
    return { error: payload.trim() };
  }

  return { error: `Recipient directory request failed with status ${status}` };
};

const buildHeaders = (ownerCustomerId) => ({
  'Content-Type': 'application/json',
  'X-Internal-Api-Key': config.recipientDirectory.apiKey,
  'X-User-ID': ownerCustomerId,
});

const request = async ({ method, path, ownerCustomerId, body, params }) => {
  return axios({
    method,
    url: `${config.recipientDirectory.baseUrl}${path}`,
    data: body,
    params,
    headers: buildHeaders(ownerCustomerId),
    timeout: config.recipientDirectory.timeoutMs,
    validateStatus: () => true,
  });
};

const mapCreatePayload = (payload = {}) => ({
  recipient_customer_id: payload.recipient_customer_id || '',
  recipient_name: payload.recipient_name || '',
  recipient_email: payload.recipient_email || '',
  nickname: payload.nickname || '',
  is_favourite: normalizeBoolean(payload.is_favorite ?? payload.is_favourite),
});

const mapUpdatePayload = (payload = {}) => ({
  nickname: payload.nickname || '',
  is_favourite: normalizeBoolean(payload.is_favorite ?? payload.is_favourite),
});

const isConfigured = () => Boolean(config.routeToggles.recipientDirectory);

const listRecipients = async (ownerCustomerId, favoritesOnly) => {
  const response = await request({
    method: 'GET',
    path: '/Recipients/',
    ownerCustomerId,
    params: favoritesOnly == null ? undefined : { favorites_only: favoritesOnly },
  });

  if (response.status !== 200) {
    return { status: response.status, data: normalizeErrorPayload(response.data, response.status) };
  }

  return {
    status: 200,
    data: Array.isArray(response.data?.data?.recipients)
      ? response.data.data.recipients.map(normalizeRecipient)
      : [],
  };
};

const getRecipient = async (ownerCustomerId, recipientId) => {
  const response = await request({
    method: 'GET',
    path: `/recipients/${encodeURIComponent(recipientId)}/`,
    ownerCustomerId,
  });

  if (response.status !== 200) {
    return { status: response.status, data: normalizeErrorPayload(response.data, response.status) };
  }

  return {
    status: 200,
    data: normalizeRecipient(response.data?.data || {}),
  };
};

const createRecipient = async (ownerCustomerId, payload) => {
  const response = await request({
    method: 'POST',
    path: '/recipients/',
    ownerCustomerId,
    body: mapCreatePayload(payload),
  });

  if (response.status !== 200) {
    return { status: response.status, data: normalizeErrorPayload(response.data, response.status) };
  }

  return {
    status: 200,
    data: normalizeRecipient(response.data?.data || {}),
  };
};

const updateRecipient = async (ownerCustomerId, recipientId, payload) => {
  const response = await request({
    method: 'PUT',
    path: `/recipients/${encodeURIComponent(recipientId)}/`,
    ownerCustomerId,
    body: mapUpdatePayload(payload),
  });

  if (response.status !== 200) {
    return { status: response.status, data: normalizeErrorPayload(response.data, response.status) };
  }

  return {
    status: 200,
    data: normalizeRecipient(response.data?.data || {}),
  };
};

const deleteRecipient = async (ownerCustomerId, recipientId) => {
  const response = await request({
    method: 'DELETE',
    path: `/recipients/${encodeURIComponent(recipientId)}/`,
    ownerCustomerId,
  });

  if (response.status !== 200) {
    return { status: response.status, data: normalizeErrorPayload(response.data, response.status) };
  }

  return {
    status: 200,
    data: {
      message: response.data?.message || 'Recipient deleted',
      recipient_id: String(response.data?.recipient_id ?? recipientId),
    },
  };
};

module.exports = {
  isConfigured,
  listRecipients,
  getRecipient,
  createRecipient,
  updateRecipient,
  deleteRecipient,
};

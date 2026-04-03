import React from 'https://cdn.jsdelivr.net/npm/react@18.3.1/+esm';
import { createRoot } from 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/client/+esm';
import htm from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/+esm';

export const html = htm.bind(React.createElement);
export const {
  useState,
  useEffect,
  useMemo,
  useCallback,
} = React;

export const API_ROOT = '/api';
export const CUSTOMER_TOKEN_KEY = 'ftds_token';
export const CUSTOMER_PROFILE_KEY = 'ftds_customer';

export const mountApp = (selector, App) => {
  const rootElement = document.querySelector(selector);
  if (!rootElement) {
    throw new Error(`Missing mount node: ${selector}`);
  }
  createRoot(rootElement).render(html`<${App} />`);
};

const toJsonSafely = async (response) => {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
};

export const fetchJson = async (url, options = {}, handlers = {}) => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 401 && handlers.onUnauthorized) {
    handlers.onUnauthorized();
    throw new Error('Session expired');
  }

  if (response.status === 403 && handlers.onForbidden) {
    handlers.onForbidden();
    throw new Error('Forbidden');
  }

  const payload = await toJsonSafely(response);
  if (!response.ok) {
    throw new Error(
      payload.error
      || payload.detail
      || payload.message
      || `Request failed with status ${response.status}`,
    );
  }
  return payload;
};

export const readCustomerSession = () => {
  const token = localStorage.getItem(CUSTOMER_TOKEN_KEY);
  const customerRaw = localStorage.getItem(CUSTOMER_PROFILE_KEY);
  if (!token || !customerRaw) return null;
  try {
    const customer = JSON.parse(customerRaw);
    return { token, customer };
  } catch (_error) {
    return null;
  }
};

export const writeCustomerSession = (token, customer) => {
  localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(customer));
};

export const clearCustomerSession = () => {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_PROFILE_KEY);
};

export const formatMoney = (currency, amount) => {
  const value = Number(amount || 0);
  return `${currency || 'USD'} ${value.toFixed(2)}`;
};

export const formatNumber = (value) => Number(value || 0).toLocaleString();

export const formatPercent = (value, maxFractionDigits = 1) =>
  `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits })}%`;

export const formatUtc = (value) => {
  if (!value) return '-';
  return new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC');
};

export const nowTime = () => new Date().toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit',
});

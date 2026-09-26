import axios from 'axios';
import { getAccessToken } from './authSession';

/**
 * The one HTTP client, pointed at the versioned API.
 *
 * Every route this application calls lives under `/api/v1`, so the version belongs in the
 * base URL rather than in each call site. `resolveBaseURL` also upgrades the two shapes the
 * `VITE_API_URL` variable held before this phase — a bare origin and an unversioned `/api`
 * base — because the unversioned runtime they addressed no longer exists, and a stale
 * deployment value should not silently produce 404s.
 */
const V1_PREFIX = '/api/v1';

const resolveBaseURL = () => {
  const envUrl = process.env.VITE_API_URL;
  if (!envUrl) return V1_PREFIX;
  const trimmed = envUrl.replace(/\/+$/, '');
  if (/\/v1$/.test(trimmed)) return trimmed;
  return trimmed.endsWith('/api') ? `${trimmed}/v1` : `${trimmed}${V1_PREFIX}`;
};

export const API_BASE_URL = resolveBaseURL();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

apiClient.interceptors.request.use(config => {
  const token = getAccessToken();
  // The API is stateless bearer-token only: no cookie is sent and no session is kept, so
  // the token travels in the standard Authorization header and nowhere else.
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['x-request-id'] = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return config;
});

apiClient.interceptors.response.use(
  response => response,
  error => {
    error.normalizedMessage = error.response?.data?.error?.message || error.response?.data?.error || error.message || 'Something went wrong.';
    return Promise.reject(error);
  }
);

export async function withRetry(request, { retries = 2, delay = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const status = error?.response?.status;
      if (status && status >= 400 && status < 500) {
        throw error;
      }
      lastError = error;
      if (attempt === retries) break;
      await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * The payload inside a MansooriKart success envelope.
 *
 * Every v1 response is `{ success: true, data, ...meta }`, so callers want `data` and not the
 * envelope. The shape is checked rather than assumed: a response that is not an envelope is
 * returned untouched, which keeps this helper safe for the health probe and for tests that
 * hand back a bare object.
 */
export const unwrap = response => {
  const body = response?.data;
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) return body.data;
  return body;
};

/** Pagination metadata travels beside `data` in the same envelope. */
export const unwrapMeta = response => {
  const body = response?.data;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const { success: _success, data: _data, ...meta } = body;
  return meta;
};

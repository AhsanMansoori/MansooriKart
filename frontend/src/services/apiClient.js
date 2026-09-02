import axios from 'axios';
import { getAccessToken } from './authSession';

const resolveBaseURL = () => {
  const envUrl = process.env.VITE_API_URL;
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  return '/api';
};

export const API_BASE_URL = resolveBaseURL();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

apiClient.interceptors.request.use(config => {
  const token = getAccessToken();
  if (token) config.headers['x-auth-token'] = token;
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

export const ACCESS_TOKEN_KEY = 'mansoorikart_access_token';
const legacyKeys = ['MERNEcommerceToken', 'token'];

export function persistAccessToken(token) {
  if (!token) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  legacyKeys.forEach(key => localStorage.removeItem(key));
}

export function getAccessToken() {
  const current = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (current) return current;
  const legacy = legacyKeys.map(key => localStorage.getItem(key)).find(Boolean);
  if (legacy) persistAccessToken(legacy);
  return legacy || null;
}

/**
 * Whether a bearer token is present.
 *
 * This is a UI affordance only: it decides what the shopper is offered, never what they are
 * allowed to do. Every protected action is authorized server-side from the token itself, so a
 * tampered localStorage buys nothing but a rejected request.
 */
export function isAuthenticated() {
  return Boolean(getAccessToken());
}

export function clearAccessToken() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  legacyKeys.forEach(key => localStorage.removeItem(key));
}

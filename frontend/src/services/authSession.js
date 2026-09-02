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

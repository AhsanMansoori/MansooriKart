/**
 * Google sign-in, browser side.
 *
 * The browser's entire job here is to obtain a Google ID token and hand it to MansooriKart.
 * The API verifies that token against Google and issues its own bearer JWT, which is the only
 * credential the rest of the app ever uses. Nothing about the Google identity is trusted from
 * this side: `POST /api/v1/auth/google` accepts exactly one field, so no role, account id or
 * email-verification claim can be smuggled in from the page.
 *
 * `VITE_GOOGLE_CLIENT_ID` is a public identifier and is meant to be readable in the shipped
 * bundle. The Google client *secret* plays no part in this flow and must never reach the browser.
 */
import { apiClient, unwrap } from './apiClient';
import { persistAccessToken } from './authSession';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * The configured client id.
 *
 * Read at call time rather than captured at import: Vite's `define` inlines the reference
 * wherever it appears, so this is still a build-time constant in the bundle, while tests can
 * exercise both the configured and unconfigured builds without reloading the module graph.
 */
export const googleClientId = () => process.env.VITE_GOOGLE_CLIENT_ID || '';

/** A build without a client id simply offers no Google option, rather than a button that cannot work. */
export const isGoogleSignInEnabled = () => Boolean(googleClientId());

let loader = null;

/** Lets a test re-exercise loading; the cached attempt is otherwise deliberately kept for the page's life. */
export function resetGoogleIdentityLoader() {
  loader = null;
}

/**
 * Load Google Identity Services once and resolve its `id` namespace.
 *
 * Resolves `null` instead of rejecting when the script cannot be reached — an extension or a
 * network policy blocking Google should degrade to the email-and-password form, not break the
 * page. The failed attempt is cached so a blocked script is not requested again and again.
 */
export function loadGoogleIdentity() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (loader) return loader;

  loader = new Promise(resolve => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    const script = existing || document.createElement('script');
    script.addEventListener('load', () => resolve(window.google?.accounts?.id || null));
    script.addEventListener('error', () => resolve(null));
    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return loader;
}

/**
 * Exchange a Google ID token for a MansooriKart session.
 *
 * The token is forwarded once and never stored: only the MansooriKart access token that comes
 * back is persisted, exactly as it is for a local sign-in.
 */
export async function signInWithGoogle(credential) {
  if (!credential) throw new Error('Google did not return a credential. Please try again.');
  const session = unwrap(await apiClient.post('auth/google', { credential }));
  if (!session?.token) throw new Error('Google sign-in did not return a session.');
  persistAccessToken(session.token);
  return session;
}

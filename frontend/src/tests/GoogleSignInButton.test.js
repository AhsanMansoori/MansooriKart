import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

/**
 * The Google button and the credential exchange behind it.
 *
 * These cases pin the two properties that matter for security: the browser sends the Google
 * credential and nothing else, and the Google ID token itself is never persisted — only the
 * MansooriKart session token is.
 */

const mockPost = jest.fn();
jest.mock('../services/apiClient', () => ({
  apiClient: { post: (...args) => mockPost(...args) },
  unwrap: response => response?.data?.data,
}));

import GoogleSignInButton from '../components/GoogleSignInButton';
import { resetGoogleIdentityLoader } from '../services/googleSignIn';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const GIS_SELECTOR = 'script[src="https://accounts.google.com/gsi/client"]';

function stubGoogleIdentity() {
  const identity = { initialize: jest.fn(), renderButton: jest.fn() };
  window.google = { accounts: { id: identity } };
  return identity;
}

const storedValues = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)));

describe('<GoogleSignInButton />', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    delete window.google;
    delete process.env.VITE_GOOGLE_CLIENT_ID;
    resetGoogleIdentityLoader();
    document.querySelectorAll(GIS_SELECTOR).forEach(node => node.remove());
  });

  afterEach(() => {
    delete process.env.VITE_GOOGLE_CLIENT_ID;
  });

  it('renders nothing when no Google client id is configured', () => {
    const { container } = render(<GoogleSignInButton />);

    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector(GIS_SELECTOR)).toBeNull();
  });

  it('initialises Google with the configured client id and renders its button', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = CLIENT_ID;
    const identity = stubGoogleIdentity();
    render(<GoogleSignInButton text="signup_with" />);

    await waitFor(() => expect(identity.initialize).toHaveBeenCalledTimes(1));
    expect(identity.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: CLIENT_ID }));
    expect(identity.renderButton).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ text: 'signup_with' }));
  });

  it('exchanges the credential for a MansooriKart session and stores only that token', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = CLIENT_ID;
    mockPost.mockResolvedValueOnce({
      data: { data: { token: 'mansoorikart-session-token', user: { email: 'shopper@example.com', role: 'CUSTOMER' }, provider: 'GOOGLE', outcome: 'CREATED' } },
    });
    const identity = stubGoogleIdentity();
    const onSuccess = jest.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} />);

    await waitFor(() => expect(identity.initialize).toHaveBeenCalledTimes(1));
    const { callback } = identity.initialize.mock.calls[0][0];
    await act(async () => {
      await callback({ credential: 'google-id-token' });
    });

    // Exactly one field goes to the API: no role, no email, no account id from the browser.
    expect(mockPost).toHaveBeenCalledWith('auth/google', { credential: 'google-id-token' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('mansoorikart_access_token')).toBe('mansoorikart-session-token');
    expect(storedValues()).not.toContain('google-id-token');
  });

  it('falls back to a notice when the Google script cannot load', async () => {
    process.env.VITE_GOOGLE_CLIENT_ID = CLIENT_ID;
    render(<GoogleSignInButton />);

    const script = await waitFor(() => {
      const node = document.querySelector(GIS_SELECTOR);
      expect(node).not.toBeNull();
      return node;
    });
    await act(async () => {
      script.dispatchEvent(new Event('error'));
    });

    expect(await screen.findByText(/google sign-in is unavailable/i)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

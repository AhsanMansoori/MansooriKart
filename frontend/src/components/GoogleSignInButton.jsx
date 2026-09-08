import React from 'react';
import { Box, Divider, Typography } from '@mui/material';
import { useNotifier } from '../context/NotificationProvider';
import { googleClientId, isGoogleSignInEnabled, loadGoogleIdentity, signInWithGoogle } from '../services/googleSignIn';

/**
 * The "Continue with Google" affordance shown on the sign-in and registration pages.
 *
 * Google renders the button itself so it keeps Google's required branding and localisation. The
 * credential it produces goes straight to the API, which is the only party that verifies it —
 * see `services/googleSignIn`. When no client id is configured the component renders nothing,
 * so a build without Google configured is simply a build with local sign-in only.
 */
function GoogleSignInButton({ text = 'signin_with', onSuccess }) {
  const containerRef = React.useRef(null);
  const { notify } = useNotifier();
  const [unavailable, setUnavailable] = React.useState(false);

  // Google holds on to the callback it is initialised with, so the handler is reached through a
  // ref to keep it from capturing a stale `notify` or `onSuccess`.
  const handlerRef = React.useRef(null);
  handlerRef.current = async response => {
    try {
      const session = await signInWithGoogle(response?.credential);
      notify({ severity: 'success', message: 'Signed in with Google. Redirecting…' });
      if (onSuccess) onSuccess(session);
      else window.location.href = '/';
    } catch (error) {
      const message = error?.normalizedMessage || error?.response?.data?.error?.message || error?.message || 'Google sign-in failed. Please try again.';
      notify({ severity: 'error', message });
    }
  };

  React.useEffect(() => {
    if (!isGoogleSignInEnabled()) return undefined;
    let active = true;

    (async () => {
      const identity = await loadGoogleIdentity();
      if (!active) return;
      if (!identity || !containerRef.current) {
        setUnavailable(true);
        return;
      }
      identity.initialize({ client_id: googleClientId(), callback: response => handlerRef.current?.(response) });
      identity.renderButton(containerRef.current, { theme: 'outline', size: 'large', shape: 'pill', width: 320, text, logo_alignment: 'center' });
    })();

    return () => {
      active = false;
    };
  }, [text]);

  if (!isGoogleSignInEnabled()) return null;

  return (
    <Box sx={{ mt: 3 }}>
      <Divider sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          or
        </Typography>
      </Divider>
      <Box ref={containerRef} sx={{ display: 'flex', justifyContent: 'center', minHeight: 40 }} />
      {unavailable && (
        <Typography variant="caption" color="text.secondary" align="center" component="p" sx={{ mt: 1 }}>
          Google sign-in is unavailable right now. Please use your email and password.
        </Typography>
      )}
    </Box>
  );
}

export default GoogleSignInButton;

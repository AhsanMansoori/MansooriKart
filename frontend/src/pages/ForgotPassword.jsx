import React, { useState } from 'react';
import { Box, Container, TextField, Typography, Button, CircularProgress, Paper, Stack } from '@mui/material';
import { apiClient } from '../services/apiClient';
import { useNotifier } from '../context/NotificationProvider';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { notify } = useNotifier();

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient.post('auth/forgot-password', { email });
      notify({ severity: 'success', message: 'If an account exists, we sent password reset instructions.' });
    } catch (err) {
      const message = err.response?.data?.msg || 'Failed to verify email';
      setError(message);
      notify({ severity: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8, mb: 10 }}>
      <Paper elevation={3} sx={{ p: { xs: 4, md: 5 }, borderRadius: 3 }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h4" align="center" fontWeight={700}>
            Forgot Password
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary">
            Enter your email address and we will send you a reset link.
          </Typography>
        </Stack>

        {error && (
          <Typography variant="body2" color="error" sx={{ display: 'none' }}>
            {error}
          </Typography>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            label="Email"
            variant="outlined"
            fullWidth
            margin="normal"
            value={email}
            type={'email'}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            {loading ? (
              <CircularProgress />
            ) : (
              <Button type="submit" variant="contained" size="large" fullWidth>
                Send reset instructions
              </Button>
            )}
          </Box>
        </form>
      </Paper>
    </Container>
  );
}

export default ForgotPassword;

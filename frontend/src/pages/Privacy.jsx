import * as React from 'react';
import { Box, Chip, Container, Divider, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import ShieldIcon from '@mui/icons-material/Shield';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LockIcon from '@mui/icons-material/Lock';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import AnalyticsIcon from '@mui/icons-material/Analytics';

const dataPractices = [
  {
    title: 'What we collect',
    body: 'Account details (name, email, and either a password hash or a Google sign-in identifier), shipping addresses, and order history.',
    icon: <AnalyticsIcon color="primary" fontSize="large" />,
  },
  {
    title: 'How we protect it',
    body: 'All sensitive data is encrypted in transit and at rest. We partner with SOC 2 Type II certified providers and review access logs weekly.',
    icon: <LockIcon color="primary" fontSize="large" />,
  },
  {
    title: 'Your controls',
    body: 'Update your profile details and saved addresses from your account at any time. To export or delete your account, send us a data request and we will handle it for you.',
    icon: <SettingsBackupRestoreIcon color="primary" fontSize="large" />,
  },
];

function Privacy() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Stack spacing={3} alignItems="center" textAlign="center" sx={{ mb: 4 }}>
        <Chip label="Privacy Policy" color="primary" variant="outlined" />
        <Typography variant="h3" fontWeight={700}>
          Your trust is the most valuable tech we protect
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680 }}>
          We collect only what we need to ship your order and keep your account working. The details below outline exactly how it works.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Last updated: April 7, 2025
        </Typography>
      </Stack>

      <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, borderRadius: 4 }}>
        <Stack spacing={5}>
          <Box>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="center" justifyContent="space-between">
              <Stack spacing={1} textAlign={{ xs: 'center', md: 'left' }}>
                <Typography variant="h5" fontWeight={700}>
                  Data lifecycle in plain English
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  From checkout to delivery alerts, our systems keep your information close and locked. We will never sell or rent your personal data.
                </Typography>
              </Stack>
              <ShieldIcon color="primary" sx={{ fontSize: 52 }} />
            </Stack>
            <LinearProgress variant="determinate" value={100} sx={{ mt: 3, borderRadius: 2, height: 8 }} />
          </Box>

          <Divider />

          <Stack spacing={4}>
            {dataPractices.map(section => (
              <Stack key={section.title} spacing={2} alignItems={{ xs: 'center', md: 'flex-start' }} textAlign={{ xs: 'center', md: 'left' }}>
                {section.icon}
                <Typography variant="h6" fontWeight={700}>
                  {section.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {section.body}
                </Typography>
              </Stack>
            ))}
          </Stack>

          <Divider />

          <Stack spacing={2}>
            <Typography variant="h5" fontWeight={700}>
              Third-party services we rely on
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sign-in with Google is handled by Google as an identity provider, and orders are paid on delivery rather than through a third-party payment
              processor. Any processor we rely on is bound by a data processing agreement and receives only the minimum required to do its job.
            </Typography>
          </Stack>

          <Stack spacing={2}>
            <Typography variant="h5" fontWeight={700}>
              Requesting access or deletion
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Send us a request through the Support Centre with “Data Request” as the topic. We will validate your identity before fulfilling the request within
              30 days.
            </Typography>
          </Stack>

          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Questions about this policy? Reach out through the Support Centre so we can help.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent={{ xs: 'center', md: 'flex-start' }}>
              <VisibilityOffIcon color="primary" fontSize="small" />
              <Typography variant="caption" color="text.secondary">
                We routinely review this policy to keep it aligned with new regulations and features.
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </Paper>
    </Container>
  );
}

export default Privacy;

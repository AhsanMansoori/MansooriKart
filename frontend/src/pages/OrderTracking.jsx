import * as React from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import QueryBuilderIcon from '@mui/icons-material/QueryBuilder';
import InventoryIcon from '@mui/icons-material/Inventory';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useNotifier } from '../context/NotificationProvider';
import { isAuthenticated } from '../services/authSession';
import { readLastOrder } from '../services/lastOrder';
import { ORDER_PROGRESS, fetchMyOrders, fetchOrderTracking, orderStatusLabel } from '../services/orders';

/**
 * Order tracking for the signed-in shopper.
 *
 * The API addresses an order by id and scopes it to the authenticated customer, so this page
 * lists the shopper's own orders and nothing else. The old form — an order number plus an email
 * address — is gone: those two strings are not a credential, and anyone holding them could read
 * somebody else's order.
 *
 * Every stage and timestamp shown below comes from the order's real status trail. Nothing is
 * invented: a stage the API has not reported yet simply carries no timestamp.
 */

/** The stages a Cash-on-Delivery order actually walks, in the API's own vocabulary. */
const STAGE_DETAIL = {
  PENDING: { description: 'We have your order and are getting it ready to confirm.', icon: <InventoryIcon /> },
  CONFIRMED: { description: 'Your order is confirmed and queued for fulfilment.', icon: <QueryBuilderIcon /> },
  PROCESSING: { description: 'Your items are being picked and packed.', icon: <WarehouseIcon /> },
  SHIPPED: { description: 'Your order has left our warehouse and is on its way to you.', icon: <LocalShippingIcon /> },
  DELIVERED: { description: 'Delivered. Payment is collected in cash on delivery.', icon: <CheckCircleOutlineIcon /> },
};

/** Statuses off the happy path. They end or divert the journey, so they are called out separately. */
const EXCEPTION_SEVERITY = {
  CANCELLED: 'warning',
  RETURN_REQUESTED: 'info',
  RETURN_APPROVED: 'info',
  RETURN_REJECTED: 'warning',
  RETURNED: 'info',
};

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

const orderId = order => String(order?._id || order?.id || '');

function OrderTracking() {
  const { notify } = useNotifier();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get('orderId') || '';

  const [signedIn, setSignedIn] = React.useState(() => isAuthenticated());
  const [orders, setOrders] = React.useState([]);
  const [ordersLoading, setOrdersLoading] = React.useState(() => isAuthenticated());
  const [selectedId, setSelectedId] = React.useState('');
  const [tracking, setTracking] = React.useState(null);
  const [trackingLoading, setTrackingLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  /** A 401 means the stored token has expired or been cleared, so the page falls back to the sign-in prompt. */
  const handleFailure = React.useCallback(
    (error, fallback) => {
      if (error?.response?.status === 401) {
        setSignedIn(false);
        setErrorMessage('Please sign in again to see your orders.');
        return;
      }
      const message = error?.normalizedMessage || fallback;
      setErrorMessage(message);
      notify({ severity: 'error', message });
    },
    [notify]
  );

  React.useEffect(() => {
    if (!signedIn) return undefined;
    let active = true;
    (async () => {
      try {
        const rows = await fetchMyOrders();
        if (!active) return;
        setOrders(rows);
        // Whatever the caller asked for wins, then the order just placed in this browser, then the newest.
        const ids = rows.map(orderId).filter(Boolean);
        const preferred = [requestedId, readLastOrder()?.orderId].find(id => id && ids.includes(String(id)));
        setSelectedId(preferred ? String(preferred) : ids[0] || '');
      } catch (error) {
        if (active) handleFailure(error, 'We could not load your orders. Please try again.');
      } finally {
        if (active) setOrdersLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [handleFailure, requestedId, signedIn]);

  const loadTracking = React.useCallback(
    async (id, { silent = false } = {}) => {
      if (!id) return;
      setTrackingLoading(true);
      setErrorMessage('');
      try {
        const data = await fetchOrderTracking(id);
        setTracking(data);
        if (!silent) notify({ severity: 'success', message: `Status updated: ${orderStatusLabel(data?.currentStatus)}` });
      } catch (error) {
        setTracking(null);
        handleFailure(error, 'We could not load that order right now.');
      } finally {
        setTrackingLoading(false);
      }
    },
    [handleFailure, notify]
  );

  React.useEffect(() => {
    if (signedIn && selectedId) loadTracking(selectedId, { silent: true });
  }, [loadTracking, selectedId, signedIn]);

  const timeline = React.useMemo(() => (Array.isArray(tracking?.timeline) ? tracking.timeline : []), [tracking]);

  /** First time each status was entered. The trail records every transition, so absence means "not yet". */
  const reachedAt = React.useMemo(() => {
    const entries = new Map();
    timeline.forEach(entry => {
      if (entry?.to && !entries.has(entry.to)) entries.set(entry.to, entry.at);
    });
    return entries;
  }, [timeline]);

  const currentStatus = tracking?.currentStatus || '';
  const exceptionSeverity = EXCEPTION_SEVERITY[currentStatus];
  // A cancelled or returned order is no longer on the delivery path, so the stepper stops at the
  // furthest stage the order genuinely reached rather than pretending the journey continues.
  const furthestIndex = ORDER_PROGRESS.reduce((furthest, status, index) => (reachedAt.has(status) ? index : furthest), -1);
  const currentIndex = ORDER_PROGRESS.indexOf(currentStatus);
  const activeIndex = currentIndex >= 0 ? currentIndex : furthestIndex;

  return (
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Stack spacing={3} alignItems="center" textAlign="center" sx={{ mb: 4 }}>
        <Chip label="Order tracking" color="primary" variant="outlined" />
        <Typography variant="h3" fontWeight={700}>
          Follow your order from checkout to doorstep
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 680 }}>
          Pick one of your orders to see exactly where it is. Updates appear here as our team moves it along.
        </Typography>
      </Stack>

      {!signedIn ? (
        <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, borderRadius: 4 }}>
          <Alert
            severity="info"
            action={
              <Button component={RouterLink} to="/login" size="small">
                Sign in
              </Button>
            }
          >
            <AlertTitle>Sign in to track your order</AlertTitle>
            Your orders are private to your account, so tracking is only available once you are signed in.
          </Alert>
        </Paper>
      ) : (
        <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, borderRadius: 4 }}>
          {ordersLoading ? (
            <Stack direction="row" spacing={2} alignItems="center">
              <CircularProgress size={24} />
              <Typography variant="body2" color="text.secondary">
                Loading your orders…
              </Typography>
            </Stack>
          ) : orders.length === 0 ? (
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h6" fontWeight={700}>
                No orders yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Once you place an order it will appear here with its live status.
              </Typography>
              <Button variant="contained" component={RouterLink} to="/shop">
                Start shopping
              </Button>
            </Stack>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <TextField
                select
                fullWidth
                label="Your orders"
                value={selectedId}
                onChange={event => setSelectedId(event.target.value)}
                helperText="Newest first"
              >
                {orders.map(order => (
                  <MenuItem key={orderId(order)} value={orderId(order)}>
                    {`#${order.orderNumber} • ${orderStatusLabel(order.orderStatus)}`}
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip title="Refresh status" arrow>
                <IconButton color="primary" onClick={() => loadTracking(selectedId)} disabled={trackingLoading || !selectedId}>
                  <ReplayIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
          {errorMessage && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 2 }}>
              {errorMessage}
            </Typography>
          )}
        </Paper>
      )}

      {signedIn && trackingLoading && !tracking && (
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ mt: 4 }}>
          <CircularProgress size={24} />
          <Typography variant="body2" color="text.secondary">
            Loading the latest status…
          </Typography>
        </Stack>
      )}

      {signedIn && tracking && (
        <Paper elevation={0} sx={{ mt: 5, p: { xs: 3, md: 5 }, borderRadius: 4 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h6" fontWeight={700}>
              Order journey
            </Typography>
            {tracking.orderNumber && <Chip label={`Order #: ${tracking.orderNumber}`} variant="outlined" color="primary" />}
          </Stack>

          {exceptionSeverity && (
            <Alert severity={exceptionSeverity} sx={{ mt: 2 }}>
              <AlertTitle>{orderStatusLabel(currentStatus)}</AlertTitle>
              This order is no longer on the delivery path. The stages below show how far it got.
            </Alert>
          )}

          <Stepper orientation="vertical" activeStep={Math.max(activeIndex, 0)} sx={{ mt: 2 }}>
            {ORDER_PROGRESS.map((status, index) => {
              const reached = reachedAt.has(status);
              const isActive = index === activeIndex;
              return (
                <Step key={status} completed={reached && !isActive}>
                  <StepLabel icon={React.cloneElement(STAGE_DETAIL[status].icon, { color: reached ? 'success' : isActive ? 'primary' : 'disabled' })}>
                    <Typography variant="subtitle1" fontWeight={700} color={isActive ? 'primary.main' : 'text.primary'}>
                      {orderStatusLabel(status)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {STAGE_DETAIL[status].description}
                    </Typography>
                    {reached && (
                      <Typography variant="caption" color="text.secondary">
                        {formatTimestamp(reachedAt.get(status)) || 'Reached'}
                      </Typography>
                    )}
                  </StepLabel>
                </Step>
              );
            })}
          </Stepper>
        </Paper>
      )}

      {signedIn && timeline.length > 0 && (
        <Paper elevation={0} sx={{ mt: 5, p: { xs: 3, md: 5 }, borderRadius: 4 }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Status updates
          </Typography>
          <List dense>
            {[...timeline].reverse().map((entry, index) => (
              <ListItem key={`${entry.to}-${entry.at || index}`} disableGutters>
                <ListItemText primary={orderStatusLabel(entry.to)} secondary={[formatTimestamp(entry.at), entry.reason].filter(Boolean).join(' • ') || null} />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      <Box sx={{ mt: 5, textAlign: 'center' }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
          <SupportAgentIcon color="primary" fontSize="small" />
          <Typography variant="caption" color="text.secondary">
            Need a delivery hold, a reroute or help with a return? Visit the <RouterLink to="/support">Support Centre</RouterLink> and our team will coordinate
            with the courier.
          </Typography>
        </Stack>
      </Box>
    </Container>
  );
}

export default OrderTracking;

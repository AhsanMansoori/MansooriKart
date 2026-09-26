import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Typography, Box, Paper, Button, Stack, Divider, Chip, List, ListItem, ListItemText } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { readLastOrder } from '../services/lastOrder';

/**
 * The confirmation shown straight after an order is placed.
 *
 * Everything here comes from the order the API returned, so the figures match what will be
 * collected on delivery. Tracking is addressed by order id — the id is what the tracking page
 * needs, and it is only readable by the account that placed the order.
 */

/** Order totals are published with their currency, so neither is assumed. */
function formatMoney(amount, currency) {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'PKR', currencyDisplay: 'narrowSymbol' }).format(amount);
  } catch (error) {
    return `${currency || 'PKR'} ${amount.toFixed(2)}`;
  }
}

function OrderSuccess() {
  const location = useLocation();
  const navigate = useNavigate();

  const fallbackMeta = React.useMemo(() => readLastOrder(), []);
  const stateMeta = location.state || {};

  const orderId = stateMeta.orderId || fallbackMeta?.orderId || '';
  const orderNumber = stateMeta.orderNumber || fallbackMeta?.orderNumber;
  const email = stateMeta.email;
  const currency = stateMeta.currency;
  const items = Array.isArray(stateMeta.items) ? stateMeta.items : [];
  const total = typeof stateMeta.total === 'number' ? stateMeta.total : null;

  const handleTrackOrder = () => navigate(orderId ? `/order-tracking?orderId=${encodeURIComponent(orderId)}` : '/order-tracking');

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6, mb: 10 }}>
      <Paper elevation={0} sx={{ p: { xs: 4, md: 6 }, textAlign: 'center', borderRadius: 4, maxWidth: 640 }}>
        <CheckCircleOutlineIcon sx={{ fontSize: 72, color: 'success.main', mb: 2 }} />
        <Typography variant="h4" gutterBottom fontWeight={700}>
          Order Successful!
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Thank you for your purchase. We’re prepping your order and will send tracking updates shortly.
        </Typography>

        {orderNumber && (
          <Stack spacing={1.5} alignItems="center" sx={{ mb: 4 }}>
            <Chip label={`Order #: ${orderNumber}`} color="primary" variant="outlined" />
            {email && (
              <Typography variant="caption" color="text.secondary">
                Confirmation sent to {email}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Payment is collected in cash when your order is delivered.
            </Typography>
          </Stack>
        )}

        {items.length > 0 && (
          <Box sx={{ textAlign: 'left', mb: 4 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Items in this order
            </Typography>
            <List dense>
              {items.map(item => (
                <ListItem key={`${item.productId}-${item.name}`} disableGutters sx={{ py: 0.5 }}>
                  <ListItemText primary={item.name} secondary={[`Qty ${item.quantity}`, formatMoney(item.unitPrice, currency)].filter(Boolean).join(' • ')} />
                </ListItem>
              ))}
            </List>
            {total !== null && <Divider sx={{ my: 2 }} />}
            {total !== null && (
              <Typography variant="subtitle2" fontWeight={600}>
                Order total: {formatMoney(total, currency)}
              </Typography>
            )}
          </Box>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
          <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/shop')}>
            Continue shopping
          </Button>
          <Button variant="outlined" onClick={handleTrackOrder}>
            Track order
          </Button>
          <Button variant="outlined" color="secondary" onClick={() => navigate('/support')}>
            Need support?
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

export default OrderSuccess;

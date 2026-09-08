import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CheckoutForm from '../components/CheckoutForm';
import {
  Typography,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Divider,
  Box,
  IconButton,
  Collapse,
  List,
  ListItem,
  ListItemAvatar,
  Avatar,
  ListItemText,
  Checkbox,
  Tooltip,
  Button,
} from '@mui/material';
import ShoppingCartCheckoutIcon from '@mui/icons-material/ShoppingCartCheckout';
import LockIcon from '@mui/icons-material/Lock';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import { useNotifier } from '../context/NotificationProvider';
import { prepareCodOrder, confirmCodOrder, toAddressPayload } from '../services/checkout';
import { rememberLastOrder } from '../services/lastOrder';
import { isAuthenticated } from '../services/authSession';

/**
 * Checkout for a Cash-on-Delivery order.
 *
 * The order itself is created by the v1 API from the server-side cart and a saved address —
 * see `services/checkout` for that sequence. This page's job is only to choose which cart lines
 * to buy, collect the delivery details, and hand both over. No card details are collected.
 */
function Checkout({ cartItems = [], onOrderComplete }) {
  const navigate = useNavigate();
  const [orderCreated, setOrderCreated] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState(() => isAuthenticated());
  const [prepared, setPrepared] = useState(null);
  const [contactEmail, setContactEmail] = useState('');
  const { notify } = useNotifier();

  const [showCartSummary, setShowCartSummary] = useState(false);
  const [selectedItems, setSelectedItems] = useState(() => {
    const defaults = cartItems.map(item => item._id || item.id).filter(Boolean);
    return new Set(defaults);
  });

  const handleSubmit = async formData => {
    if (!selectedItems.size) {
      notify({ severity: 'warning', message: 'Select at least one item before checking out.' });
      return;
    }

    const itemsToPurchase = cartItems.filter(item => {
      const id = item._id || item.id;
      return id && selectedItems.has(id);
    });

    if (!itemsToPurchase.length) {
      notify({ severity: 'warning', message: 'Selected items are unavailable. Please refresh your cart.' });
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const next = await prepareCodOrder({ items: itemsToPurchase, address: toAddressPayload(formData) });
      setPrepared(next);
      setContactEmail(formData.email?.trim() || '');
      notify({ severity: 'info', message: 'Review the server-calculated total, then confirm your order.' });
    } catch (error) {
      if (error?.response?.status === 401) setSignedIn(false);
      const message = error?.normalizedMessage || error?.message || 'Something went wrong while preparing your order.';
      setErrorMessage(message);
      notify({ severity: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const confirmOrder = async () => {
    if (!prepared) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const order = await confirmCodOrder(prepared);
      rememberLastOrder(order);
      setOrderCreated(true);
      onOrderComplete?.(prepared.body.items.map(item => item.productId));
      notify({ severity: 'success', message: 'Order placed successfully! Redirecting…' });

      navigate('/order-success', {
        state: {
          orderId: order?._id ? String(order._id) : '',
          orderNumber: order?.orderNumber,
          email: contactEmail,
          items: order?.items,
          total: order?.total,
          currency: order?.currency,
        },
      });
    } catch (error) {
      // A 401 means the token expired between opening the page and submitting, so the form
      // reverts to asking for a sign-in rather than retrying a request that cannot succeed.
      if (error?.response?.status === 401) setSignedIn(false);
      const message = error?.normalizedMessage || error?.message || 'Something went wrong while confirming your order.';
      setErrorMessage(message);
      notify({ severity: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const itemsToShow = cartItems.filter(item => {
    const id = item._id || item.id;
    return id && selectedItems.has(id);
  });
  const total = itemsToShow.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
  const allSelected = cartItems.every(item => selectedItems.has(item._id || item.id));

  const toggleItem = id => {
    if (!id) return;
    setPrepared(null);
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setPrepared(null);
    setSelectedItems(prev => {
      if (prev.size === cartItems.length) {
        return new Set();
      }
      return new Set(cartItems.map(item => item._id || item.id).filter(Boolean));
    });
  };

  return (
    <Container maxWidth="md" sx={{ pb: 10 }}>
      <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, borderRadius: 4 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
          <ShoppingCartCheckoutIcon color="primary" fontSize="large" />
          <Box>
            <Typography variant="h4" gutterBottom>
              Checkout
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You have {itemsToShow.length} item{itemsToShow.length !== 1 ? 's' : ''} selected. Estimated subtotal PKR {total.toFixed(2)}.
            </Typography>
          </Box>
        </Stack>

        <Divider sx={{ mb: 3 }} />

        {cartItems.length > 0 && (
          <Paper elevation={0} sx={{ mb: 4, borderRadius: 3, background: 'rgba(40,116,240,0.06)', p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <ShoppingBagIcon color="primary" />
              <Typography variant="subtitle1" fontWeight={600}>
                Selected items ({itemsToShow.length}/{cartItems.length})
              </Typography>
              <Tooltip title={allSelected ? 'Deselect all items' : 'Select all items'}>
                <Checkbox
                  color="primary"
                  checked={allSelected}
                  indeterminate={selectedItems.size > 0 && !allSelected}
                  onChange={toggleAll}
                  sx={{ ml: 'auto' }}
                />
              </Tooltip>
              <IconButton size="small" onClick={() => setShowCartSummary(prev => !prev)}>
                <ExpandMoreIcon
                  sx={{
                    transform: showCartSummary ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </IconButton>
            </Stack>
            <Collapse in={showCartSummary} timeout="auto" unmountOnExit>
              <List dense>
                {cartItems.map(item => {
                  const id = item._id || item.id;
                  if (!id) return null;
                  const checked = selectedItems.has(id);
                  return (
                    <ListItem key={id} secondaryAction={<Checkbox edge="end" color="primary" checked={checked} onChange={() => toggleItem(id)} />}>
                      <ListItemAvatar>
                        <Avatar src={item.image} alt={item.name} variant="rounded" />
                      </ListItemAvatar>
                      <ListItemText primary={item.name} secondary={`PKR ${(item.price || 0).toFixed(2)}`} />
                    </ListItem>
                  );
                })}
                {selectedItems.size === 0 && (
                  <ListItem>
                    <ListItemText primary="No items selected. Choose at least one item to proceed." />
                  </ListItem>
                )}
              </List>
            </Collapse>
          </Paper>
        )}

        {orderCreated ? (
          <Typography variant="h5" gutterBottom>
            Thank you for your order! You will be redirected shortly.
          </Typography>
        ) : (
          <>
            {loading && <CircularProgress sx={{ mb: 3 }} />}
            {errorMessage && (
              <Typography color="error" sx={{ display: 'none' }}>
                {errorMessage}
              </Typography>
            )}
            <CheckoutForm onSubmit={handleSubmit} onChange={() => setPrepared(null)} submitting={loading} signedIn={signedIn} />
            {prepared?.quote && (
              <Paper variant="outlined" sx={{ mt: 3, p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Server total
                </Typography>
                {[
                  ['Subtotal', prepared.quote.subtotal],
                  ['Discount', -prepared.quote.discount],
                  ['Shipping', prepared.quote.shipping],
                  ['Tax', prepared.quote.tax],
                  ['Payable', prepared.quote.total],
                ].map(([label, amount]) => (
                  <Stack key={label} direction="row" justifyContent="space-between">
                    <Typography fontWeight={label === 'Payable' ? 700 : 400}>{label}</Typography>
                    <Typography fontWeight={label === 'Payable' ? 700 : 400}>PKR {Number(amount).toFixed(2)}</Typography>
                  </Stack>
                ))}
                <Button variant="contained" sx={{ mt: 2 }} disabled={loading} onClick={confirmOrder}>
                  Confirm COD order
                </Button>
              </Paper>
            )}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, color: 'text.secondary' }}>
              <LockIcon fontSize="small" />
              <Typography variant="caption">Cash on Delivery is available. MansooriKart never collects card details directly.</Typography>
            </Stack>
          </>
        )}
      </Paper>
    </Container>
  );
}

export default Checkout;

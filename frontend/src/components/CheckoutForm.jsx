import React, { useState } from 'react';
import { TextField, Button, Typography, Grid, Box, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio, Alert } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useNotifier } from '../context/NotificationProvider';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const initialForm = {
  fullName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateProvince: '',
  postalCode: '',
  country: '',
  paymentMethod: 'COD',
};

/**
 * Contact and delivery details for a Cash-on-Delivery order.
 *
 * The fields mirror what the v1 address contract requires — a full name, phone, street, city
 * and country — because the order is placed against a saved address rather than a free-text
 * block. No card details are collected anywhere in this flow.
 */
function CheckoutForm({ onSubmit, onChange, submitting = false, signedIn = true, submitLabel = 'Review COD order' }) {
  const [formData, setFormData] = useState(initialForm);
  const { notify } = useNotifier();
  const update = event => {
    setFormData(current => ({ ...current, [event.target.name]: event.target.value }));
    onChange?.();
  };

  const submit = event => {
    event.preventDefault();
    if (!emailPattern.test(formData.email)) return notify({ severity: 'error', message: 'Enter a valid email address.' });
    if (formData.paymentMethod === 'ONLINE') return notify({ severity: 'info', message: 'Online payment is not available yet.' });
    onSubmit(formData);
  };

  return (
    <form onSubmit={submit}>
      <Typography variant="h4" gutterBottom>
        Contact & delivery
      </Typography>

      {!signedIn && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={
            <Button component={RouterLink} to="/login" size="small">
              Sign in
            </Button>
          }
        >
          Please sign in to place your order.
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6}>
          <TextField required name="fullName" label="Full Name" fullWidth value={formData.fullName} onChange={update} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField required type="email" name="email" label="Email Address" fullWidth value={formData.email} onChange={update} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField required name="phone" label="Phone Number" fullWidth value={formData.phone} onChange={update} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField required name="city" label="City" fullWidth value={formData.city} onChange={update} />
        </Grid>
        <Grid item xs={12}>
          <TextField required name="addressLine1" label="Address" fullWidth value={formData.addressLine1} onChange={update} />
        </Grid>
        <Grid item xs={12}>
          <TextField name="addressLine2" label="Apartment, suite, etc. (optional)" fullWidth value={formData.addressLine2} onChange={update} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField name="stateProvince" label="State / Province (optional)" fullWidth value={formData.stateProvince} onChange={update} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField name="postalCode" label="Postal Code (optional)" fullWidth value={formData.postalCode} onChange={update} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <TextField required name="country" label="Country" fullWidth value={formData.country} onChange={update} />
        </Grid>
      </Grid>

      <FormControl sx={{ mt: 4 }}>
        <FormLabel>Payment method</FormLabel>
        <RadioGroup name="paymentMethod" value={formData.paymentMethod} onChange={update}>
          <FormControlLabel value="COD" control={<Radio />} label="Cash on Delivery" />
          <FormControlLabel value="ONLINE" control={<Radio />} label="Online payment (not available yet)" />
        </RadioGroup>
      </FormControl>

      <Box sx={{ mt: 3 }}>
        <Button type="submit" variant="contained" disabled={submitting || !signedIn}>
          {submitting ? 'Calculating total…' : submitLabel}
        </Button>
      </Box>
    </form>
  );
}
export default CheckoutForm;

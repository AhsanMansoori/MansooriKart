import React, { useState } from 'react';
import { TextField, Button, Typography, Grid, Box, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio } from '@mui/material';
import { useNotifier } from '../context/NotificationProvider';

function CheckoutForm({ onSubmit, submitting = false }) {
  const [formData, setFormData] = useState({ name: '', email: '', shippingAddress: '', paymentMethod: 'COD' });
  const { notify } = useNotifier();
  const update = event => setFormData(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = event => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return notify({ severity: 'error', message: 'Enter a valid email address.' });
    if (formData.paymentMethod === 'ONLINE') return notify({ severity: 'info', message: 'Online payment is not available yet.' });
    onSubmit(formData);
  };

  return (
    <form onSubmit={submit}>
      <Typography variant="h4" gutterBottom>
        Contact & delivery
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField required name="name" label="Full Name" fullWidth value={formData.name} onChange={update} />
        </Grid>
        <Grid item xs={12}>
          <TextField required type="email" name="email" label="Email Address" fullWidth value={formData.email} onChange={update} />
        </Grid>
        <Grid item xs={12}>
          <TextField
            required
            name="shippingAddress"
            label="Shipping Address"
            multiline
            minRows={3}
            fullWidth
            value={formData.shippingAddress}
            onChange={update}
          />
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
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? 'Placing order…' : 'Place COD order'}
        </Button>
      </Box>
    </form>
  );
}
export default CheckoutForm;

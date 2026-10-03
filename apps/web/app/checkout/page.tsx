'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CreditCard, Banknote, Lock, ChevronRight, ShoppingBag } from 'lucide-react';
import { Button, Input, Select, formatCurrency, Badge } from '@mansoorikart/ui';
import { useCart, useStoreConfig, useAuth } from '../../components/providers';

const UAE_EMIRATES = [
  { value: 'Dubai', label: 'Dubai' },
  { value: 'Abu Dhabi', label: 'Abu Dhabi' },
  { value: 'Sharjah', label: 'Sharjah' },
  { value: 'Ajman', label: 'Ajman' },
  { value: 'Ras Al Khaimah', label: 'Ras Al Khaimah' },
  { value: 'Fujairah', label: 'Fujairah' },
  { value: 'Umm Al Quwain', label: 'Umm Al Quwain' },
];

export default function CheckoutPage() {
  const router = useRouter();
  const { items, itemCount, subtotal, clearCart } = useCart();
  const { config } = useStoreConfig();
  const { user } = useAuth();

  const [shippingMethod, setShippingMethod] = React.useState<'standard' | 'sameday'>('standard');
  const [paymentMethod, setPaymentMethod] = React.useState<'card' | 'cod'>('card');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Form State
  const defaultAddress = user?.addresses?.find(a => a.isDefault) || user?.addresses?.[0];
  const [formData, setFormData] = React.useState({
    email: user?.email || '',
    phone: user?.phone || '+971 50 123 4567',
    firstName: user?.name ? user.name.split(' ')[0] : '',
    lastName: user?.name ? user.name.split(' ').slice(1).join(' ') : '',
    emirate: defaultAddress?.emirate || 'Dubai',
    city: defaultAddress?.city || 'Dubai',
    street: defaultAddress?.street || '',
    building: defaultAddress?.building || '',
    deliveryNotes: '',
    // Card fields
    cardNumber: '4242 •••• •••• 4242',
    cardExpiry: '12/28',
    cardCvc: '•••',
    cardName: user?.name || '',
  });

  const [couponCode, setCouponCode] = React.useState('');
  const [discountPercent, setDiscountPercent] = React.useState(0);
  const [couponMsg, setCouponMsg] = React.useState('');

  const freeThreshold = config.shipping.freeShippingThreshold || 150;
  const isFreeStandard = subtotal >= freeThreshold;
  const shippingFee = shippingMethod === 'sameday' ? 25 : isFreeStandard ? 0 : config.shipping.standardFee;

  const discountAmount = (subtotal * discountPercent) / 100;
  const vatAmount = (subtotal - discountAmount) * 0.05;
  const grandTotal = subtotal - discountAmount + shippingFee + vatAmount;

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    const code = couponCode.trim().toUpperCase();
    if (code === 'WELCOME10' || code === 'MANSOORI10') {
      setDiscountPercent(10);
      setCouponMsg('10% discount applied!');
      setCouponCode('');
    } else {
      setCouponMsg('Invalid coupon code.');
    }
  };

  const handlePlaceOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const orderId = `MK-${Math.floor(100000 + Math.random() * 900000)}`;
    const orderRecord = {
      orderId,
      date: new Date().toLocaleDateString('en-AE', { year: 'numeric', month: 'short', day: 'numeric' }),
      items: [...items],
      subtotal,
      discountAmount,
      shippingFee,
      vatAmount,
      grandTotal,
      currency: config.currency.code,
      shippingAddress: {
        fullName: `${formData.firstName} ${formData.lastName}`.trim(),
        email: formData.email,
        phone: formData.phone,
        emirate: formData.emirate,
        city: formData.city,
        street: formData.street,
        building: formData.building,
      },
      paymentMethod: paymentMethod === 'card' ? 'Credit / Debit Card (Ending in 4242)' : 'Cash on Delivery (COD)',
      estimatedDelivery: 'Tomorrow, between 9:00 AM - 6:00 PM',
      status: 'Confirmed',
    };

    try {
      localStorage.setItem('mk_last_order', JSON.stringify(orderRecord));
      // append to orders list
      const prevOrders = JSON.parse(localStorage.getItem('mk_user_orders') || '[]');
      localStorage.setItem('mk_user_orders', JSON.stringify([orderRecord, ...prevOrders]));
    } catch {
      // storage
    }

    setTimeout(() => {
      clearCart();
      router.push(`/order-success?orderId=${orderId}`);
    }, 600);
  };

  if (items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-3xl p-10 border border-slate-100 shadow-sm space-y-4">
          <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto" />
          <h1 className="text-xl font-bold text-brand-navy">Your cart is empty</h1>
          <p className="text-xs text-slate-500">Please add items to your cart before proceeding to checkout.</p>
          <Link href="/shop">
            <Button variant="primary" size="md" className="rounded-full px-6 font-bold text-xs mt-2">
              Browse Products
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-canvas min-h-screen py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Checkout Steps Nav */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm font-semibold">
            <Link href="/cart" className="text-slate-400 hover:text-brand-teal transition-colors">
              1. Cart
            </Link>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span className="text-brand-teal font-bold flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-brand-teal text-white flex items-center justify-center text-[10px]">2</span>
              Customer & Delivery
            </span>
            <ChevronRight className="w-4 h-4 text-slate-300" />
            <span className="text-slate-400">3. Confirmation</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Lock className="w-3.5 h-3.5 text-brand-mint" /> 256-Bit SSL Encrypted
          </div>
        </div>

        <form onSubmit={handlePlaceOrder}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Form Details */}
            <div className="lg:col-span-7 space-y-6">
              {/* Express Checkout */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block text-center">Express UAE Checkout</span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className="py-3 px-4 rounded-2xl bg-black text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-900 transition-colors cursor-pointer"
                  >
                    <span>Apple Pay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className="py-3 px-4 rounded-2xl bg-slate-100 border border-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <span>Google Pay</span>
                  </button>
                </div>
                <div className="relative text-center">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-slate-100" />
                  </div>
                  <span className="relative bg-white px-3 text-[11px] text-slate-400 uppercase font-bold tracking-wider">Or enter delivery details</span>
                </div>
              </div>

              {/* 1. Contact Information */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
                <h2 className="text-base font-bold text-brand-navy flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-surface-mint text-brand-teal flex items-center justify-center text-xs">1</span>
                  Contact Information
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address</label>
                    <Input
                      type="email"
                      required
                      placeholder="e.g. ahmed@example.ae"
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">UAE Mobile Number</label>
                    <Input
                      type="tel"
                      required
                      placeholder="+971 50 123 4567"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Shipping Address */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
                <h2 className="text-base font-bold text-brand-navy flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-surface-mint text-brand-teal flex items-center justify-center text-xs">2</span>
                  Shipping Address in UAE
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">First Name</label>
                    <Input
                      type="text"
                      required
                      placeholder="Ahmed"
                      value={formData.firstName}
                      onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                      className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Last Name</label>
                    <Input
                      type="text"
                      required
                      placeholder="Mansoori"
                      value={formData.lastName}
                      onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                      className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Emirate</label>
                    <Select
                      options={UAE_EMIRATES}
                      value={formData.emirate}
                      onChange={e => setFormData({ ...formData, emirate: e.target.value })}
                      className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Area</label>
                    <Input
                      type="text"
                      required
                      placeholder="e.g. Downtown Dubai / Jumeirah"
                      value={formData.city}
                      onChange={e => setFormData({ ...formData, city: e.target.value })}
                      className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Street Address</label>
                  <Input
                    type="text"
                    required
                    placeholder="Street name, landmark"
                    value={formData.street}
                    onChange={e => setFormData({ ...formData, street: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Building, Apartment / Villa #</label>
                  <Input
                    type="text"
                    required
                    placeholder="Building name, Floor, Flat or Villa number"
                    value={formData.building}
                    onChange={e => setFormData({ ...formData, building: e.target.value })}
                    className="bg-slate-50 border-slate-200 text-xs rounded-xl"
                  />
                </div>
              </div>

              {/* 3. Shipping Method */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
                <h2 className="text-base font-bold text-brand-navy flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-surface-mint text-brand-teal flex items-center justify-center text-xs">3</span>
                  Delivery Method
                </h2>

                <div className="space-y-3">
                  <label
                    className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                      shippingMethod === 'standard' ? 'border-brand-teal bg-surface-teal/40' : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shipping"
                        checked={shippingMethod === 'standard'}
                        onChange={() => setShippingMethod('standard')}
                        className="text-brand-teal focus:ring-brand-teal"
                      />
                      <div>
                        <span className="text-xs sm:text-sm font-bold text-brand-navy block">Standard Express UAE Delivery</span>
                        <span className="text-[11px] text-slate-500">Delivered within 1-2 business days across all Emirates</span>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-brand-teal">
                      {isFreeStandard ? 'FREE' : formatCurrency(config.shipping.standardFee, config.currency.code, 2)}
                    </span>
                  </label>

                  <label
                    className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                      shippingMethod === 'sameday' ? 'border-brand-teal bg-surface-teal/40' : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shipping"
                        checked={shippingMethod === 'sameday'}
                        onChange={() => setShippingMethod('sameday')}
                        className="text-brand-teal focus:ring-brand-teal"
                      />
                      <div>
                        <span className="text-xs sm:text-sm font-bold text-brand-navy flex items-center gap-2">
                          Same-Day Dubai Prime Delivery
                          <Badge variant="bestseller" size="sm">
                            FASTEST
                          </Badge>
                        </span>
                        <span className="text-[11px] text-slate-500">Order before 2:00 PM for delivery today in Dubai</span>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-brand-navy">AED 25.00</span>
                  </label>
                </div>
              </div>

              {/* 4. Payment Method */}
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-4">
                <h2 className="text-base font-bold text-brand-navy flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-surface-mint text-brand-teal flex items-center justify-center text-xs">4</span>
                  Payment Method
                </h2>

                <div className="space-y-3">
                  {/* Credit Card Option */}
                  <div
                    className={`p-4 rounded-2xl border-2 transition-all ${
                      paymentMethod === 'card' ? 'border-brand-teal bg-surface-teal/20' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="payment"
                          checked={paymentMethod === 'card'}
                          onChange={() => setPaymentMethod('card')}
                          className="text-brand-teal focus:ring-brand-teal"
                        />
                        <span className="text-xs sm:text-sm font-bold text-brand-navy flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-brand-teal" /> Credit or Debit Card
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-semibold">Visa / Mastercard / AMEX</span>
                    </label>

                    {paymentMethod === 'card' && (
                      <div className="mt-4 pt-4 border-t border-slate-200/80 space-y-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Card Number</label>
                          <Input
                            type="text"
                            placeholder="4242 4242 4242 4242"
                            value={formData.cardNumber}
                            onChange={e => setFormData({ ...formData, cardNumber: e.target.value })}
                            className="bg-white border-slate-200 text-xs rounded-xl"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Expiry (MM/YY)</label>
                            <Input
                              type="text"
                              placeholder="12/28"
                              value={formData.cardExpiry}
                              onChange={e => setFormData({ ...formData, cardExpiry: e.target.value })}
                              className="bg-white border-slate-200 text-xs rounded-xl"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">CVV / CVC</label>
                            <Input
                              type="password"
                              maxLength={4}
                              placeholder="123"
                              value={formData.cardCvc}
                              onChange={e => setFormData({ ...formData, cardCvc: e.target.value })}
                              className="bg-white border-slate-200 text-xs rounded-xl"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cash on Delivery Option */}
                  <div
                    className={`p-4 rounded-2xl border-2 transition-all ${
                      paymentMethod === 'cod' ? 'border-brand-teal bg-surface-teal/20' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="payment"
                          checked={paymentMethod === 'cod'}
                          onChange={() => setPaymentMethod('cod')}
                          className="text-brand-teal focus:ring-brand-teal"
                        />
                        <span className="text-xs sm:text-sm font-bold text-brand-navy flex items-center gap-2">
                          <Banknote className="w-4 h-4 text-brand-mint" /> Cash on Delivery (COD)
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 font-medium">Pay at door</span>
                    </label>
                    {paymentMethod === 'cod' && (
                      <p className="mt-2 text-[11px] text-slate-500 pl-7">Pay conveniently with cash or card upon delivery directly to our courier.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Order Summary */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-5 sticky top-28">
                <h2 className="text-base font-black text-brand-navy pb-3 border-b border-slate-100 flex items-center justify-between">
                  <span>Order Review</span>
                  <span className="text-xs font-semibold text-slate-500">{itemCount} items</span>
                </h2>

                {/* Items Rail */}
                <div className="max-h-60 overflow-y-auto space-y-3 pr-1 divide-y divide-slate-100">
                  {items.map(item => (
                    <div key={item.id} className="pt-3 first:pt-0 flex gap-3 items-center">
                      <div className="relative w-14 h-14 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
                        {item.image && <Image src={item.image} alt={item.title} fill sizes="56px" className="object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-brand-navy line-clamp-1">{item.title}</h4>
                        <p className="text-[11px] text-slate-400">Qty: {item.quantity}</p>
                      </div>
                      <span className="text-xs font-bold text-brand-navy">{formatCurrency(item.price * item.quantity, config.currency.code, 2)}</span>
                    </div>
                  ))}
                </div>

                {/* Coupon Code */}
                <div className="pt-2">
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Discount code"
                      value={couponCode}
                      onChange={e => setCouponCode(e.target.value)}
                      className="bg-slate-50 border-slate-200 text-xs rounded-xl uppercase"
                    />
                    <Button type="button" onClick={handleApplyCoupon} variant="secondary" size="sm" className="rounded-xl text-xs font-bold shrink-0">
                      Apply
                    </Button>
                  </div>
                  {couponMsg && <p className={`text-[11px] mt-1.5 font-bold ${discountPercent > 0 ? 'text-brand-mint' : 'text-brand-red'}`}>{couponMsg}</p>}
                </div>

                {/* Price Calculations */}
                <div className="space-y-2 text-xs border-t border-slate-100 pt-4">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-bold text-brand-navy">{formatCurrency(subtotal, config.currency.code, 2)}</span>
                  </div>
                  {discountPercent > 0 && (
                    <div className="flex justify-between text-brand-mint font-bold">
                      <span>Discount ({discountPercent}%)</span>
                      <span>-{formatCurrency(discountAmount, config.currency.code, 2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>Shipping</span>
                    <span className="font-bold text-brand-mint">{shippingFee === 0 ? 'FREE' : formatCurrency(shippingFee, config.currency.code, 2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>UAE VAT (5%)</span>
                    <span className="font-medium text-slate-700">{formatCurrency(vatAmount, config.currency.code, 2)}</span>
                  </div>
                  <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline">
                    <span className="text-base font-black text-brand-navy">Total</span>
                    <div className="text-right">
                      <span className="text-2xl font-black text-brand-teal">{formatCurrency(grandTotal, config.currency.code, 2)}</span>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={isSubmitting}
                  className="w-full rounded-2xl font-bold text-sm shadow-md shadow-brand-mint/20"
                >
                  {isSubmitting ? 'Processing Order...' : `Place Order • ${formatCurrency(grandTotal, config.currency.code, 2)}`}
                </Button>

                <p className="text-[11px] text-center text-slate-400">By clicking Place Order you agree to MansooriKart Terms & Conditions.</p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

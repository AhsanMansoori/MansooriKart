'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingBag, Trash2, Plus, Minus, ArrowRight, ShieldCheck, Truck, RotateCcw, Sparkles, Tag, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button, PriceDisplay, formatCurrency, Input } from '@mansoorikart/ui';
import { useCart, useStoreConfig } from '../../components/providers';

export default function CartPage() {
  const { items, itemCount, subtotal, removeItem, updateQuantity, clearCart } = useCart();
  const { config } = useStoreConfig();

  const [couponCode, setCouponCode] = React.useState('');
  const [appliedCoupon, setAppliedCoupon] = React.useState<{ code: string; discountPercent: number } | null>(null);
  const [couponError, setCouponError] = React.useState('');
  const [couponSuccess, setCouponSuccess] = React.useState('');

  const freeThreshold = config.shipping.freeShippingThreshold || 150;
  const isFreeShipping = subtotal >= freeThreshold;
  const amountNeeded = Math.max(0, freeThreshold - subtotal);
  const progressPercent = Math.min(100, Math.round((subtotal / freeThreshold) * 100));

  const discountAmount = appliedCoupon ? (subtotal * appliedCoupon.discountPercent) / 100 : 0;
  const shippingFee = isFreeShipping || items.length === 0 ? 0 : config.shipping.standardFee;
  const vatAmount = (subtotal - discountAmount) * 0.05;
  const grandTotal = subtotal - discountAmount + shippingFee + vatAmount;

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError('');
    setCouponSuccess('');
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setCouponError('Please enter a coupon code.');
      return;
    }
    if (code === 'MANSOORI10' || code === 'WELCOME10' || code === 'DUBAI10') {
      setAppliedCoupon({ code, discountPercent: 10 });
      setCouponSuccess('10% discount applied successfully!');
      setCouponCode('');
    } else if (code === 'SAVE20') {
      setAppliedCoupon({ code, discountPercent: 20 });
      setCouponSuccess('20% mega saver discount applied!');
      setCouponCode('');
    } else {
      setCouponError('Invalid coupon code. Try WELCOME10 or MANSOORI10.');
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponSuccess('');
    setCouponError('');
  };

  if (items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="max-w-md mx-auto bg-white rounded-3xl p-10 border border-slate-100 shadow-sm space-y-5">
          <div className="w-20 h-20 rounded-full bg-surface-mint flex items-center justify-center mx-auto text-brand-teal">
            <ShoppingBag className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-brand-navy">Your Cart is Empty</h1>
            <p className="text-sm text-slate-500 mt-2">
              Looks like you haven&apos;t added any items to your shopping cart yet. Browse our top electronics and lifestyle collections!
            </p>
          </div>
          <Link href="/shop" className="inline-block pt-2">
            <Button variant="primary" size="lg" className="rounded-full px-8 gap-2 font-bold shadow-sm">
              <ShoppingBag className="w-4 h-4" /> Start Shopping Now
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-canvas min-h-screen py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-6 font-medium">
          <Link href="/" className="hover:text-brand-teal transition-colors">
            Home
          </Link>
          <span>/</span>
          <span className="text-brand-navy font-bold">Shopping Cart</span>
        </nav>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-brand-navy tracking-tight">Shopping Cart</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              You have <strong className="text-brand-teal">{itemCount} items</strong> in your cart
            </p>
          </div>
          <button
            type="button"
            onClick={clearCart}
            className="text-xs font-semibold text-slate-400 hover:text-brand-red flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear All Items
          </button>
        </div>

        {/* Free Shipping Progress Card */}
        <div className="mb-8 p-4 sm:p-5 rounded-2xl bg-white border border-border-mint shadow-xs">
          {amountNeeded > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs sm:text-sm font-semibold text-brand-navy">
                <span className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-brand-teal" />
                  Add <strong className="text-brand-teal">{formatCurrency(amountNeeded, config.currency.code, 0)}</strong> more to get{' '}
                  <strong>FREE Express Delivery</strong> in UAE!
                </span>
                <span className="text-xs font-bold text-slate-500">{progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className="bg-brand-mint h-2 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm font-bold text-brand-mint-dark">
              <Sparkles className="w-5 h-5 text-brand-mint shrink-0" />
              <span>Congratulations! Your order qualifies for FREE Express UAE Delivery.</span>
            </div>
          )}
        </div>

        {/* Two Columns Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Items List */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden divide-y divide-slate-100">
              {items.map(item => (
                <div key={item.id} className="p-4 sm:p-6 flex flex-col sm:flex-row gap-4 sm:gap-6 items-start sm:items-center">
                  {/* Image */}
                  <div className="relative w-24 h-24 rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
                    {item.image ? (
                      <Image src={item.image} alt={item.title} fill sizes="96px" className="object-cover object-center" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <ShoppingBag className="w-8 h-8" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-brand-navy hover:text-brand-teal transition-colors line-clamp-2">
                      <Link href={item.slug ? `/product/${item.slug}` : '/shop'}>{item.title}</Link>
                    </h3>
                    {item.color && (
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                        <span>Color:</span>
                        <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">{item.color}</span>
                      </p>
                    )}
                    <div className="mt-2 text-sm">
                      <PriceDisplay amount={item.price} originalAmount={item.originalPrice} currency={config.currency.code} size="sm" showDiscount={false} />
                    </div>
                  </div>

                  {/* Quantity Stepper & Subtotal */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-4">
                    <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-10 text-center text-sm font-bold text-brand-navy">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-base font-black text-brand-teal">{formatCurrency(item.price * item.quantity, config.currency.code, 2)}</span>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-slate-400 hover:text-brand-red p-1 rounded-lg transition-colors"
                        title="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Coupon Code Input & Navigation */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <Link href="/shop" className="inline-flex items-center gap-2 text-xs font-bold text-brand-teal hover:underline">
                <ArrowLeft className="w-3.5 h-3.5" /> Continue Shopping
              </Link>

              <form onSubmit={handleApplyCoupon} className="flex gap-2 w-full sm:w-auto">
                <Input
                  type="text"
                  placeholder="Discount code (e.g. WELCOME10)"
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value)}
                  className="bg-white border-slate-200 text-xs rounded-xl uppercase max-w-xs"
                />
                <Button type="submit" variant="secondary" size="md" className="rounded-xl text-xs font-bold shrink-0">
                  <Tag className="w-3.5 h-3.5 mr-1" /> Apply
                </Button>
              </form>
            </div>

            {couponSuccess && (
              <p className="text-xs font-bold text-brand-mint flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {couponSuccess}
              </p>
            )}
            {couponError && <p className="text-xs font-bold text-brand-red">{couponError}</p>}
          </div>

          {/* Right Column: Order Summary */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8 space-y-5">
              <h2 className="text-lg font-black text-brand-navy tracking-tight pb-3 border-b border-slate-100">Order Summary</h2>

              <div className="space-y-3 text-xs sm:text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal ({itemCount} items)</span>
                  <span className="font-bold text-brand-navy">{formatCurrency(subtotal, config.currency.code, 2)}</span>
                </div>

                {appliedCoupon && (
                  <div className="flex justify-between text-brand-mint font-bold">
                    <span className="flex items-center gap-1">
                      Coupon ({appliedCoupon.code})
                      <button type="button" onClick={removeCoupon} className="text-slate-400 hover:text-brand-red text-[11px] underline ml-1">
                        remove
                      </button>
                    </span>
                    <span>-{formatCurrency(discountAmount, config.currency.code, 2)}</span>
                  </div>
                )}

                <div className="flex justify-between text-slate-600">
                  <span>Estimated Delivery</span>
                  <span className="font-bold text-brand-mint">{shippingFee === 0 ? 'FREE' : formatCurrency(shippingFee, config.currency.code, 2)}</span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>Estimated UAE VAT (5%)</span>
                  <span className="font-medium text-slate-700">{formatCurrency(vatAmount, config.currency.code, 2)}</span>
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="text-base font-black text-brand-navy">Estimated Total</span>
                  <div className="text-right">
                    <span className="text-2xl font-black text-brand-teal">{formatCurrency(grandTotal, config.currency.code, 2)}</span>
                    <span className="block text-[10px] text-slate-400">All taxes included</span>
                  </div>
                </div>
              </div>

              <Link href="/checkout" className="block pt-2">
                <Button variant="primary" size="lg" className="w-full rounded-2xl font-bold gap-2 text-sm shadow-md shadow-brand-mint/20">
                  Proceed to Checkout <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>

              {/* Guarantees */}
              <div className="pt-4 border-t border-slate-100 space-y-2.5 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-brand-mint shrink-0" />
                  <span>256-Bit SSL Encrypted Checkout</span>
                </div>
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-brand-teal shrink-0" />
                  <span>Express UAE Next-Day Delivery</span>
                </div>
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-brand-mint shrink-0" />
                  <span>14-Day Free Returns Guarantee</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

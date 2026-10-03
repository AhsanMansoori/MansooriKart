'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight, ShieldCheck, Truck, Sparkles } from 'lucide-react';
import { Button, PriceDisplay, formatCurrency } from '@mansoorikart/ui';
import { useCart, useStoreConfig } from './providers';

export function CartDrawer() {
  const { items, itemCount, subtotal, removeItem, updateQuantity, isCartDrawerOpen, setIsCartDrawerOpen } = useCart();
  const { config } = useStoreConfig();

  // Close on Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCartDrawerOpen) {
        setIsCartDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCartDrawerOpen, setIsCartDrawerOpen]);

  if (!isCartDrawerOpen) return null;

  const freeThreshold = config.shipping.freeShippingThreshold || 150;
  const amountNeeded = Math.max(0, freeThreshold - subtotal);
  const progressPercent = Math.min(100, Math.round((subtotal / freeThreshold) * 100));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-brand-navy/60 backdrop-blur-xs transition-opacity duration-300"
        onClick={() => setIsCartDrawerOpen(false)}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col">
          {/* Drawer Header */}
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-surface-canvas">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-surface-mint flex items-center justify-center text-brand-teal">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-brand-navy">
                Your Shopping Cart <span className="text-xs text-slate-500 font-normal">({itemCount} items)</span>
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setIsCartDrawerOpen(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Close cart drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Free Shipping Progress Indicator (Add-to-Cart.png banner) */}
          <div className="p-4 bg-surface-mint border-b border-border-mint">
            {amountNeeded > 0 ? (
              <div>
                <p className="text-xs font-semibold text-brand-navy mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-brand-teal" /> Add{' '}
                    <strong className="text-brand-teal">{formatCurrency(amountNeeded, config.currency.code, 0)}</strong> more for FREE UAE Delivery!
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold">{progressPercent}%</span>
                </p>
                <div className="w-full bg-emerald-200/60 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-brand-mint h-1.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-bold text-brand-mint-dark">
                <Sparkles className="w-4 h-4 text-brand-mint shrink-0" />
                <span>You have unlocked FREE Express Delivery anywhere in the UAE!</span>
              </div>
            )}
          </div>

          {/* Items List */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
                  <ShoppingBag className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-brand-navy">Your cart is empty</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs">
                    Discover thousands of authentic tech, fashion, and home essentials with next-day UAE delivery.
                  </p>
                </div>
                <Button variant="primary" size="md" onClick={() => setIsCartDrawerOpen(false)} className="rounded-full px-6 text-xs font-bold">
                  <Link href="/shop">Start Shopping</Link>
                </Button>
              </div>
            ) : (
              items.map(item => (
                <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex gap-3.5 group">
                  {/* Thumbnail */}
                  <div className="relative w-20 h-20 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
                    {item.image ? (
                      <Image src={item.image} alt={item.title} fill sizes="80px" className="object-cover object-center" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <ShoppingBag className="w-6 h-6" />
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-brand-navy line-clamp-2 leading-snug hover:text-brand-teal transition-colors">
                          <Link href={item.slug ? `/product/${item.slug}` : '/shop'} onClick={() => setIsCartDrawerOpen(false)}>
                            {item.title}
                          </Link>
                        </h4>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-slate-400 hover:text-brand-red p-1 rounded-md transition-colors shrink-0"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {item.color && (
                        <span className="inline-block mt-1 text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{item.color}</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      {/* Quantity Stepper */}
                      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-8 text-center text-xs font-bold text-brand-navy">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"
                          aria-label="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Price */}
                      <div className="text-right">
                        <PriceDisplay
                          amount={item.price * item.quantity}
                          originalAmount={item.originalPrice ? item.originalPrice * item.quantity : undefined}
                          currency={config.currency.code}
                          size="sm"
                          showDiscount={false}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Drawer Footer */}
          {items.length > 0 && (
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-surface-canvas space-y-3">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-bold text-brand-navy">{formatCurrency(subtotal, config.currency.code, 2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Estimated UAE VAT (5%)</span>
                  <span className="font-medium text-slate-700">{formatCurrency(subtotal * 0.05, config.currency.code, 2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Shipping</span>
                  <span className="font-bold text-brand-mint">
                    {amountNeeded === 0 ? 'FREE' : formatCurrency(config.shipping.standardFee, config.currency.code, 2)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200/80 flex justify-between text-sm font-black text-brand-navy">
                  <span>Total Amount</span>
                  <span className="text-base text-brand-teal">
                    {formatCurrency(subtotal + subtotal * 0.05 + (amountNeeded === 0 ? 0 : config.shipping.standardFee), config.currency.code, 2)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Link href="/cart" onClick={() => setIsCartDrawerOpen(false)} className="w-full">
                  <Button variant="outline" size="md" className="w-full text-xs font-bold rounded-xl border-slate-200 hover:bg-slate-50">
                    View Cart
                  </Button>
                </Link>

                <Link href="/checkout" onClick={() => setIsCartDrawerOpen(false)} className="w-full">
                  <Button variant="primary" size="md" className="w-full text-xs font-bold rounded-xl gap-1.5 shadow-sm">
                    Checkout <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>

              <div className="flex items-center justify-center gap-3 text-[11px] text-slate-400 pt-1">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-brand-mint" /> 256-Bit SSL Secure
                </span>
                <span>•</span>
                <span>100% Genuine UAE Stock</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

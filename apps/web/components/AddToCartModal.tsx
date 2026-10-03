'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { X, CheckCircle2, ShoppingBag, ArrowRight, Truck } from 'lucide-react';
import { Button, PriceDisplay, formatCurrency } from '@mansoorikart/ui';
import { useCart, useStoreConfig } from './providers';

export interface AddedProductInfo {
  id: string;
  title: string;
  price: number;
  image?: string;
  quantity: number;
}

interface AddToCartModalProps {
  product: AddedProductInfo | null;
  onClose: () => void;
}

export function AddToCartModal({ product, onClose }: AddToCartModalProps) {
  const { subtotal, itemCount } = useCart();
  const { config } = useStoreConfig();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (product) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [product, onClose]);

  if (!product) return null;

  const freeThreshold = config.shipping.freeShippingThreshold || 100;
  const currentSubtotal = Math.max(subtotal, product.price * product.quantity);
  const diffToFree = Math.max(0, freeThreshold - currentSubtotal);
  const freePct = Math.min(100, Math.round((currentSubtotal / freeThreshold) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-navy/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-100 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-brand-mint">
            <CheckCircle2 className="w-5 h-5 fill-brand-mint/20 text-brand-mint" />
            <h3 className="text-base font-bold text-brand-navy">Added to Your Cart</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Product Details Preview */}
        <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-white shrink-0 border border-slate-100">
            {product.image ? (
              <Image src={product.image} alt={product.title} fill className="object-cover" sizes="80px" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-300">
                <ShoppingBag className="w-8 h-8" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-brand-navy line-clamp-2 leading-snug">{product.title}</h4>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">Qty: {product.quantity}</span>
              <PriceDisplay amount={product.price * product.quantity} size="sm" />
            </div>
          </div>
        </div>

        {/* Free Shipping Progress Indicator */}
        <div className="p-3.5 rounded-2xl bg-surface-mint border border-border-mint space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-brand-navy">
            <span className="flex items-center gap-1.5 text-brand-teal">
              <Truck className="w-4 h-4 text-brand-mint" />
              {diffToFree > 0 ? `Add ${formatCurrency(diffToFree, config.currency.code, 0)} more for FREE UAE Delivery` : '🎉 You unlocked FREE UAE Delivery!'}
            </span>
            <span className="text-[11px] font-mono text-slate-500">{freePct}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-mint transition-all duration-500" style={{ width: `${freePct}%` }} />
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3 pt-2">
          <Link href="/cart" onClick={onClose} className="block w-full">
            <Button variant="primary" size="lg" className="w-full gap-2 text-sm font-bold shadow-md shadow-brand-mint/20">
              <ShoppingBag className="w-4 h-4" />
              View Cart ({itemCount || product.quantity} items)
              <ArrowRight className="w-4 h-4 ml-auto" />
            </Button>
          </Link>
          <Button variant="outline" size="md" onClick={onClose} className="w-full text-xs font-semibold">
            Continue Shopping
          </Button>
        </div>
      </div>
    </div>
  );
}

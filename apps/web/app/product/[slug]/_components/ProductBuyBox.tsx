'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, Zap, CheckCircle2, ShieldCheck, Truck, RotateCcw, Flame, ChevronRight } from 'lucide-react';
import { Button, PriceDisplay, formatCurrency, tokens } from '@mansoorikart/ui';
import type { CatalogProduct } from '../../../../lib/api/types';
import { AddToCartModal, type AddedProductInfo } from '../../../../components/AddToCartModal';
import { useCart, useStoreConfig } from '../../../../components/providers';

interface ProductBuyBoxProps {
  product: CatalogProduct;
}

export function ProductBuyBox({ product }: ProductBuyBoxProps) {
  const router = useRouter();
  const { addItem } = useCart();
  const { config } = useStoreConfig();

  const [quantity, setQuantity] = React.useState(1);
  const [selectedColor, setSelectedColor] = React.useState(product.colors?.[0]?.name || 'Midnight Black');
  const [addedProduct, setAddedProduct] = React.useState<AddedProductInfo | null>(null);

  const colors = product.colors || [
    { name: 'Midnight Black', hex: tokens.colors.brand.navyDark, inStock: true },
    { name: 'Silver Mist', hex: tokens.colors.border.default, inStock: true },
    { name: 'Nordic Teal', hex: tokens.colors.brand.teal, inStock: true },
    { name: 'Classic Navy', hex: tokens.colors.brand.navy, inStock: true },
  ];

  const productImage =
    Array.isArray(product.images) && product.images.length > 0
      ? typeof product.images[0] === 'string'
        ? product.images[0]
        : product.images[0].url
      : undefined;

  const handleAddToCart = () => {
    addItem({
      productId: product.id,
      title: product.name,
      price: product.price,
      quantity,
      image: productImage,
    });
    setAddedProduct({
      id: product.id,
      title: product.name,
      price: product.price,
      image: productImage,
      quantity,
    });
  };

  const handleBuyNow = () => {
    addItem({
      productId: product.id,
      title: product.name,
      price: product.price,
      quantity,
      image: productImage,
    });
    router.push('/cart');
  };

  const discountAmount = product.compareAtPrice ? product.compareAtPrice - product.price : 0;
  const discountPct = product.compareAtPrice ? Math.round((discountAmount / product.compareAtPrice) * 100) : 0;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left / Center Actions & Variant Selectors (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Color Selector */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">
                Color: <span className="font-bold text-brand-navy">{selectedColor}</span>
              </span>
            </div>

            <div className="flex items-center gap-3">
              {colors.map(c => {
                const isSelected = c.name === selectedColor;
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setSelectedColor(c.name)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center p-0.5 border-2 transition-all ${
                      isSelected ? 'border-brand-teal ring-2 ring-brand-teal/20 scale-110 shadow-xs' : 'border-slate-200 hover:border-slate-400'
                    }`}
                    title={c.name}
                  >
                    <span className="w-full h-full rounded-full border border-black/10" style={{ backgroundColor: c.hex }} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantity Stepper & Stock Countdown */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-500 block">Quantity</span>
            <div className="flex items-center gap-4">
              <div className="inline-flex items-center rounded-xl bg-slate-100 border border-slate-200 p-1">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-xs"
                  disabled={quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  -
                </button>
                <span className="w-10 text-center text-xs font-bold text-brand-navy">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => q + 1)}
                  className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-slate-700 font-bold hover:bg-slate-50 transition-colors shadow-xs"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>

              {product.availableStock && product.availableStock <= 10 && (
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-red">
                  <Flame className="w-4 h-4 fill-brand-red text-brand-red animate-bounce" />
                  Only {product.availableStock} left in stock!
                </div>
              )}
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              variant="primary"
              size="lg"
              onClick={handleAddToCart}
              className="flex-1 rounded-full gap-2 text-sm font-bold shadow-lg shadow-brand-mint/25"
            >
              <ShoppingBag className="w-4 h-4" />
              Add to Cart
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={handleBuyNow}
              className="flex-1 rounded-full gap-2 text-sm font-bold bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-500 hover:to-amber-400 text-brand-navy border-0 shadow-md shadow-amber-300/30"
            >
              <Zap className="w-4 h-4 fill-brand-navy" />
              Buy Now
            </Button>
          </div>

          {/* Trust Highlights Strip */}
          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-slate-100 text-center text-xs text-slate-600">
            <div className="flex flex-col items-center gap-1">
              <Truck className="w-4 h-4 text-brand-teal" />
              <span className="font-semibold text-brand-navy">Free Delivery</span>
              <span className="text-[10px] text-slate-400">Over AED 100</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <RotateCcw className="w-4 h-4 text-brand-mint" />
              <span className="font-semibold text-brand-navy">Easy Returns</span>
              <span className="text-[10px] text-slate-400">Within 30 days</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-brand-teal" />
              <span className="font-semibold text-brand-navy">Secure Payment</span>
              <span className="text-[10px] text-slate-400">100% Protected</span>
            </div>
          </div>
        </div>

        {/* Right Reassurance Buy Box Card (5 Cols) */}
        <div className="lg:col-span-5 p-6 rounded-3xl bg-slate-50/80 border border-slate-200/80 space-y-5">
          {/* Price Header */}
          <div>
            <PriceDisplay amount={product.price} originalAmount={product.compareAtPrice} size="xl" />
            {discountAmount > 0 && (
              <div className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-gold/15 text-brand-navy text-xs font-bold">
                You save {formatCurrency(discountAmount, product.currency || 'AED', 0)} ({discountPct}%)
              </div>
            )}
          </div>

          {/* Value Checklist */}
          <ul className="space-y-2.5 text-xs text-slate-700 font-medium">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-brand-mint shrink-0" />
              <span>In stock & ready to ship across UAE</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-brand-mint shrink-0" />
              <span>Free express delivery over {formatCurrency(config.shipping.freeShippingThreshold || 100, 'AED', 0)}</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-brand-mint shrink-0" />
              <span>1 year official manufacturer warranty included</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-brand-mint shrink-0" />
              <span>30-day hassle-free return guarantee</span>
            </li>
          </ul>

          {/* Authorized Seller Badge */}
          <div className="p-3.5 rounded-2xl bg-white border border-border-mint space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-brand-navy">
              <ShieldCheck className="w-4 h-4 text-brand-teal shrink-0" />
              <span>100% Original Product</span>
            </div>
            <p className="text-[11px] text-slate-500">Verified Authorized Distributor in UAE.</p>
            <div className="pt-1">
              <span className="text-xs font-semibold text-brand-teal inline-flex items-center gap-1 hover:underline cursor-pointer">
                View seller information <ChevronRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        </div>
      </div>

      <AddToCartModal product={addedProduct} onClose={() => setAddedProduct(null)} />
    </>
  );
}

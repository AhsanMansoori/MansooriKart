'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Heart, ShoppingBag, Trash2, Share2, CheckCircle2 } from 'lucide-react';
import { Button, PriceDisplay, Badge } from '@mansoorikart/ui';
import { useWishlist, useCart, useStoreConfig, type WishlistItem } from '../../../components/providers';

export default function AccountWishlistPage() {
  const { items, wishlistCount, removeFromWishlist, clearWishlist } = useWishlist();
  const { addItem, setIsCartDrawerOpen } = useCart();
  const { config } = useStoreConfig();
  const [copied, setCopied] = React.useState(false);

  const handleMoveToCart = (item: WishlistItem) => {
    addItem({
      productId: item.id,
      title: item.title,
      price: item.price,
      originalPrice: item.originalPrice,
      image: item.image,
      slug: item.slug,
    });
    removeFromWishlist(item.id);
    setIsCartDrawerOpen(true);
  };

  const handleMoveAllToCart = () => {
    items.forEach(item => {
      addItem({
        productId: item.id,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        image: item.image,
        slug: item.slug,
      });
    });
    clearWishlist();
    setIsCartDrawerOpen(true);
  };

  const handleShareWishlist = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-black text-brand-navy tracking-tight">My Wishlist</h1>
            <Badge variant="teal" size="sm">
              {wishlistCount} {wishlistCount === 1 ? 'ITEM' : 'ITEMS'}
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Save your favorite gadgets and essentials to purchase anytime</p>
        </div>

        {items.length > 0 && (
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleShareWishlist}
              className="rounded-xl text-xs font-bold gap-1.5 border-slate-200 hover:bg-slate-50"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-mint" /> Copied
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" /> Share
                </>
              )}
            </Button>

            <Button variant="primary" size="sm" onClick={handleMoveAllToCart} className="rounded-xl text-xs font-bold gap-1.5 shadow-sm">
              <ShoppingBag className="w-3.5 h-3.5" /> Move All to Cart
            </Button>

            <button
              type="button"
              onClick={clearWishlist}
              className="p-2 text-slate-400 hover:text-brand-red transition-colors rounded-lg hover:bg-slate-100 cursor-pointer"
              title="Clear Wishlist"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Wishlist Items Grid */}
      {items.length === 0 ? (
        <div className="p-12 text-center max-w-sm mx-auto space-y-3">
          <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center mx-auto">
            <Heart className="w-8 h-8 stroke-[1.25]" />
          </div>
          <h2 className="text-base font-bold text-brand-navy">Your Wishlist is Empty</h2>
          <p className="text-xs text-slate-500">Browse our shop and click the heart icon on any product to save it here for later.</p>
          <div className="pt-2">
            <Link href="/shop">
              <Button variant="primary" size="sm" className="rounded-full px-6 text-xs font-bold">
                Explore Products
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map(item => (
            <div
              key={item.id}
              className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden flex flex-col group relative hover:border-border-teal hover:shadow-card-hover transition-all"
            >
              {/* Remove Button */}
              <button
                type="button"
                onClick={() => removeFromWishlist(item.id)}
                className="absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full bg-white/90 backdrop-blur-xs flex items-center justify-center text-slate-400 hover:text-brand-red shadow-sm transition-colors cursor-pointer"
                title="Remove from wishlist"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              {/* Thumbnail */}
              <Link href={item.slug ? `/product/${item.slug}` : '/shop'} className="relative aspect-square bg-slate-50 overflow-hidden block">
                {item.badge && (
                  <span className="absolute top-2.5 left-2.5 z-10">
                    <Badge variant="discount" size="sm">
                      {item.badge}
                    </Badge>
                  </span>
                )}
                {item.image ? (
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover object-center group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300">
                    <ShoppingBag className="w-8 h-8" />
                  </div>
                )}
              </Link>

              {/* Details */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  {item.category && <span className="text-[10px] font-bold uppercase tracking-wider text-brand-teal block mb-1">{item.category}</span>}
                  <h3 className="text-xs sm:text-sm font-bold text-brand-navy line-clamp-2 leading-snug hover:text-brand-teal transition-colors">
                    <Link href={item.slug ? `/product/${item.slug}` : '/shop'}>{item.title}</Link>
                  </h3>
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <PriceDisplay amount={item.price} originalAmount={item.originalPrice} currency={config.currency.code} size="sm" showDiscount={false} />

                  <Button variant="primary" size="sm" onClick={() => handleMoveToCart(item)} className="w-full rounded-xl text-xs font-bold gap-1.5 shadow-xs">
                    <ShoppingBag className="w-3.5 h-3.5" /> Move to Cart
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ProductCard, type ProductData, Button, PriceDisplay, Rating } from '@mansoorikart/ui';
import { ShoppingBag, Heart } from 'lucide-react';
import { AddToCartModal, type AddedProductInfo } from '../../../components/AddToCartModal';
import { useCart } from '../../../components/providers';

interface ShopProductGridProps {
  products: ProductData[];
  viewMode: 'grid' | 'list';
}

export function ShopProductGrid({ products, viewMode }: ShopProductGridProps) {
  const { addItem } = useCart();
  const [addedProduct, setAddedProduct] = React.useState<AddedProductInfo | null>(null);
  const [wishlistedIds, setWishlistedIds] = React.useState<Set<string>>(new Set());

  const handleAddToCart = (_e: React.MouseEvent, product: ProductData) => {
    addItem({
      productId: product.id,
      title: product.title,
      price: product.price,
      quantity: 1,
      image: product.image,
    });
    setAddedProduct({
      id: product.id,
      title: product.title,
      price: product.price,
      image: product.image,
      quantity: 1,
    });
  };

  const handleToggleWishlist = (_e: React.MouseEvent, productId: string) => {
    setWishlistedIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  if (products.length === 0) {
    return (
      <div className="rounded-3xl bg-slate-50 border border-slate-100 p-12 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
          <ShoppingBag className="w-8 h-8 stroke-[1.25]" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-brand-navy">No products found</h3>
          <p className="text-xs sm:text-sm text-slate-500 max-w-sm mx-auto">
            Try adjusting your search keywords, clear category selections, or broaden your price filter range.
          </p>
        </div>
        <Link href="/shop" className="inline-block pt-2">
          <Button variant="outline" size="sm">
            Reset All Filters
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {products.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              actionVariant="button"
              isWishlisted={wishlistedIds.has(product.id)}
              onAddToCart={handleAddToCart}
              onToggleWishlist={handleToggleWishlist}
            />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="space-y-4">
          {products.map(product => {
            const isWishlisted = wishlistedIds.has(product.id);
            return (
              <div
                key={product.id}
                className="group flex flex-col sm:flex-row items-center gap-6 p-4 rounded-3xl bg-white border border-slate-100 hover:border-border-teal hover:shadow-[0_8px_30px_-4px_rgba(13,148,136,0.12)] transition-all"
              >
                {/* Image */}
                <div className="relative w-full sm:w-48 aspect-square rounded-2xl overflow-hidden bg-slate-50 shrink-0">
                  <Link href={`/product/${product.slug || product.id}`}>
                    {product.image ? (
                      <Image
                        src={product.image}
                        alt={product.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 100vw, 200px"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <ShoppingBag className="w-12 h-12" />
                      </div>
                    )}
                  </Link>
                </div>

                {/* Content */}
                <div className="flex-1 space-y-2 text-center sm:text-left">
                  {product.category && <span className="text-[11px] font-bold uppercase tracking-wider text-brand-teal">{product.category}</span>}
                  <Link href={`/product/${product.slug || product.id}`}>
                    <h3 className="text-base font-bold text-brand-navy hover:text-brand-teal transition-colors line-clamp-2">{product.title}</h3>
                  </Link>

                  {product.rating !== undefined && <Rating value={product.rating} count={product.ratingCount} size="sm" showValue showCount />}

                  <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-4">
                    <PriceDisplay amount={product.price} originalAmount={product.originalPrice} size="md" showDiscount />

                    <div className="flex items-center gap-2">
                      <Button variant="primary" size="sm" onClick={e => handleAddToCart(e, product)} className="rounded-full px-4 gap-1.5 text-xs font-bold">
                        <ShoppingBag className="w-3.5 h-3.5" /> Add to Cart
                      </Button>
                      <button
                        type="button"
                        onClick={e => handleToggleWishlist(e, product.id)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors ${
                          isWishlisted ? 'bg-red-50 border-red-200 text-brand-red' : 'border-slate-200 text-slate-400 hover:text-brand-red'
                        }`}
                        aria-label="Wishlist"
                      >
                        <Heart className={`w-4 h-4 ${isWishlisted ? 'fill-brand-red' : ''}`} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddToCartModal product={addedProduct} onClose={() => setAddedProduct(null)} />
    </>
  );
}

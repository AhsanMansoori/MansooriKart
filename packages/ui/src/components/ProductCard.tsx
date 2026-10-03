import * as React from 'react';
import { Heart, ShoppingBag, Eye } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge, type BadgeProps } from './Badge';
import { Rating } from './Rating';
import { PriceDisplay } from './PriceDisplay';
import { Button } from './Button';

export interface ProductData {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  image?: string;
  rating?: number;
  ratingCount?: number;
  badge?: string;
  badgeVariant?: BadgeProps['variant'];
  category?: string;
  inStock?: boolean;
  slug?: string;
  href?: string;
}

export interface ProductCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The core product object */
  product: ProductData;
  /** Optional link override */
  href?: string;
  /** Callback fired when user clicks Add to Cart */
  onAddToCart?: (e: React.MouseEvent, product: ProductData) => void;
  /** Callback fired when user toggles wishlist */
  onToggleWishlist?: (e: React.MouseEvent, productId: string) => void;
  /** Callback fired when quick view button is clicked */
  onQuickView?: (e: React.MouseEvent, product: ProductData) => void;
  /** Whether the product is currently in the customer's wishlist */
  isWishlisted?: boolean;
  /** Whether Add to Cart action is currently loading */
  isAddingToCart?: boolean;
  /** Aspect ratio of the product image container */
  aspectRatio?: 'square' | 'portrait' | 'video';
  /** Action button layout style */
  actionVariant?: 'button' | 'iconOnly';
}

/**
 * ProductCard Component
 * Highly polished, reusable product card aligned with the MansooriKart storefront design.
 * Features wishlist toggle, status badge, rating, dynamic AED price display, and add-to-cart trigger.
 *
 * Example usage:
 * ```tsx
 * <ProductCard
 *   product={{
 *     id: 'prod_1',
 *     title: 'Wireless Noise-Canceling Earbuds Pro',
 *     price: 249,
 *     originalPrice: 329,
 *     badge: '-24%',
 *     badgeVariant: 'discount',
 *     rating: 4.8,
 *     ratingCount: 156,
 *     category: 'Audio & Tech'
 *   }}
 *   onAddToCart={(_, p) => console.log('Add', p)}
 * />
 * ```
 */
export const ProductCard = React.forwardRef<HTMLDivElement, ProductCardProps>(
  (
    {
      product,
      href,
      onAddToCart,
      onToggleWishlist,
      onQuickView,
      isWishlisted = false,
      isAddingToCart = false,
      aspectRatio = 'square',
      actionVariant = 'button',
      className,
      ...props
    },
    ref
  ) => {
    const [imageError, setImageError] = React.useState(false);

    const aspectClasses = {
      square: 'aspect-square',
      portrait: 'aspect-[4/5]',
      video: 'aspect-[16/9]',
    };

    const productHref = href || product.href || (product.slug ? `/product/${product.slug}` : undefined);

    // Calculate discount tag automatically if badge not explicitly supplied
    const computedBadge =
      product.badge ||
      (product.originalPrice && product.originalPrice > product.price
        ? `-${Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%`
        : undefined);

    const computedBadgeVariant = product.badgeVariant || (computedBadge?.startsWith('-') ? 'discount' : 'teal');

    const imageElement =
      product.image && !imageError ? (
        <img
          src={product.image}
          alt={product.title}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 text-slate-300 bg-gradient-to-br from-slate-50 to-slate-100">
          <ShoppingBag className="w-12 h-12 stroke-[1.25] text-slate-300 mb-1" />
          <span className="text-[11px] font-medium text-slate-400 text-center line-clamp-1">{product.title}</span>
        </div>
      );

    return (
      <div
        ref={ref}
        className={cn(
          'group relative flex flex-col rounded-2xl bg-white border border-slate-100 overflow-hidden',
          'transition-all duration-300 ease-out',
          'hover:shadow-[0_14px_34px_-4px_rgba(13,148,136,0.12),0_6px_14px_-2px_rgba(11,25,44,0.04)] hover:border-border-teal hover:-translate-y-1',
          className
        )}
        {...props}
      >
        {/* Top Media / Thumbnail Container */}
        <div className={cn('relative w-full overflow-hidden bg-slate-50 flex items-center justify-center', aspectClasses[aspectRatio])}>
          {/* Badge at Top Left */}
          {computedBadge && (
            <div className="absolute top-3 left-3 z-10 pointer-events-none">
              <Badge variant={computedBadgeVariant} size="sm">
                {computedBadge}
              </Badge>
            </div>
          )}

          {/* Wishlist Toggle Button at Top Right */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onToggleWishlist?.(e, product.id);
            }}
            aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            className={cn(
              'absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200',
              'bg-white/90 backdrop-blur-xs shadow-sm hover:scale-110 active:scale-95',
              isWishlisted ? 'text-brand-red bg-white shadow-xs' : 'text-slate-400 hover:text-brand-red'
            )}
          >
            <Heart className={cn('w-4 h-4 transition-transform', isWishlisted && 'fill-brand-red stroke-brand-red')} />
          </button>

          {/* Quick View Hover Button */}
          {onQuickView && (
            <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-3">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onQuickView(e, product);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-navy/80 backdrop-blur-xs text-white text-xs font-medium hover:bg-brand-navy transition-colors shadow-sm"
              >
                <Eye className="w-3.5 h-3.5" />
                Quick View
              </button>
            </div>
          )}

          {/* Product Image / Fallback Placeholder */}
          {productHref ? (
            <a href={productHref} className="block w-full h-full">
              {imageElement}
            </a>
          ) : (
            imageElement
          )}
        </div>

        {/* Card Body */}
        <div className="flex flex-col flex-1 p-4">
          {/* Category / Eyebrow */}
          {product.category && <span className="text-[11px] font-semibold tracking-wider uppercase text-brand-teal mb-1 truncate">{product.category}</span>}

          {/* Product Title */}
          <h3
            className="text-sm font-semibold text-brand-navy leading-snug line-clamp-2 min-h-[2.5rem] group-hover:text-brand-teal transition-colors"
            title={product.title}
          >
            {productHref ? (
              <a href={productHref} className="hover:text-brand-teal transition-colors">
                {product.title}
              </a>
            ) : (
              product.title
            )}
          </h3>

          {/* Star Rating & Review Count */}
          <div className="mt-2 flex items-center min-h-[1.25rem]">
            {product.rating !== undefined ? (
              <Rating value={product.rating} count={product.ratingCount} size="sm" showValue showCount />
            ) : (
              <span className="text-xs text-slate-400 italic">No reviews yet</span>
            )}
          </div>

          {/* Pricing & Add to Cart Footer */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            <PriceDisplay amount={product.price} originalAmount={product.originalPrice} size="sm" />

            {actionVariant === 'button' ? (
              <Button
                variant="primary"
                size="sm"
                isLoading={isAddingToCart}
                onClick={e => onAddToCart?.(e, product)}
                className="gap-1.5 px-3 py-1.5 text-xs font-semibold shrink-0"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                Add
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                isLoading={isAddingToCart}
                onClick={e => onAddToCart?.(e, product)}
                aria-label="Add to cart"
                className="w-8 h-8 rounded-full shrink-0"
              >
                <ShoppingBag className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ProductCard.displayName = 'ProductCard';

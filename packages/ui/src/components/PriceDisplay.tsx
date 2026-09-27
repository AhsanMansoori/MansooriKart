import * as React from 'react';
import { cn } from '../lib/utils';

export interface PriceDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The current active price in AED */
  amount: number;
  /** Optional original or list price for strikethrough comparison */
  originalAmount?: number;
  /** Currency code (defaults to 'AED') */
  currency?: string;
  /** Size scale of the price typography */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Show the currency prefix (e.g. 'AED') */
  showCurrency?: boolean;
  /** Show the calculated discount badge if originalAmount > amount */
  showDiscount?: boolean;
}

/**
 * Pure helper function to format a numeric value into standardized AED currency string.
 * Single source of truth for the entire platform.
 */
export function formatCurrency(amount: number, currency = 'AED', decimals?: number): string {
  if (isNaN(amount)) return `${currency} 0`;

  const hasDecimals = decimals !== undefined ? decimals > 0 : amount % 1 !== 0;
  const formattedNumber = new Intl.NumberFormat('en-AE', {
    minimumFractionDigits: hasDecimals ? (decimals ?? 2) : 0,
    maximumFractionDigits: hasDecimals ? (decimals ?? 2) : 0,
  }).format(amount);

  return `${currency} ${formattedNumber}`;
}

const sizeStyles = {
  sm: {
    current: 'text-sm font-bold',
    original: 'text-xs',
    currency: 'text-xs font-semibold mr-1',
    discount: 'text-[10px] px-1.5 py-0.5',
    gap: 'gap-1.5',
  },
  md: {
    current: 'text-base font-bold',
    original: 'text-xs',
    currency: 'text-xs font-semibold mr-1',
    discount: 'text-xs px-2 py-0.5',
    gap: 'gap-2',
  },
  lg: {
    current: 'text-xl font-extrabold',
    original: 'text-sm',
    currency: 'text-sm font-semibold mr-1',
    discount: 'text-xs px-2 py-0.5',
    gap: 'gap-2.5',
  },
  xl: {
    current: 'text-2xl sm:text-3xl font-extrabold',
    original: 'text-base',
    currency: 'text-base font-semibold mr-1.5',
    discount: 'text-xs px-2.5 py-0.5',
    gap: 'gap-3',
  },
};

/**
 * PriceDisplay Component
 * Single source of truth for currency formatting across MansooriKart.
 * Formats numbers to UAE Dirham (AED) with proper thousands separators.
 *
 * Example usage:
 * ```tsx
 * <PriceDisplay amount={149} originalAmount={199} size="md" showDiscount />
 * ```
 */
export const PriceDisplay = React.forwardRef<HTMLDivElement, PriceDisplayProps>(
  ({ amount, originalAmount, currency = 'AED', size = 'md', showCurrency = true, showDiscount = false, className, ...props }, ref) => {
    const sizeConfig = sizeStyles[size];
    const hasDiscount = originalAmount !== undefined && originalAmount > amount;
    const discountPercent = hasDiscount ? Math.round(((originalAmount - amount) / originalAmount) * 100) : 0;

    return (
      <div ref={ref} className={cn('inline-flex items-baseline flex-wrap', sizeConfig.gap, className)} {...props}>
        <span className={cn('text-[#0B192C] tracking-tight', sizeConfig.current)}>
          {showCurrency && <span className={cn('text-[#0D9488]', sizeConfig.currency)}>{currency}</span>}
          {new Intl.NumberFormat('en-AE', {
            minimumFractionDigits: amount % 1 !== 0 ? 2 : 0,
            maximumFractionDigits: 2,
          }).format(amount)}
        </span>

        {hasDiscount && <span className={cn('text-slate-400 line-through font-normal', sizeConfig.original)}>{formatCurrency(originalAmount, currency)}</span>}

        {hasDiscount && showDiscount && discountPercent > 0 && (
          <span className={cn('rounded-full font-bold bg-[#EF4444]/10 text-[#EF4444]', sizeConfig.discount)}>-{discountPercent}%</span>
        )}
      </div>
    );
  }
);

PriceDisplay.displayName = 'PriceDisplay';

import * as React from 'react';
import { Star } from 'lucide-react';
import { cn } from '../lib/utils';

export interface RatingProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rating score between 0 and 5 */
  value: number;
  /** Total number of reviews */
  count?: number;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show the numeric rating value (e.g. 4.8) */
  showValue?: boolean;
  /** Show the review count badge (e.g. (124)) */
  showCount?: boolean;
  /** Maximum number of stars (default 5) */
  max?: number;
}

const sizeClasses = {
  sm: {
    star: 'w-3.5 h-3.5',
    text: 'text-xs',
    gap: 'gap-0.5',
  },
  md: {
    star: 'w-4 h-4',
    text: 'text-sm',
    gap: 'gap-1',
  },
  lg: {
    star: 'w-5 h-5',
    text: 'text-base',
    gap: 'gap-1.5',
  },
};

/**
 * Rating Component
 * Read-only star display with customizable score and review count badge.
 *
 * Example usage:
 * ```tsx
 * <Rating value={4.8} count={128} size="md" showValue showCount />
 * ```
 */
export const Rating = React.forwardRef<HTMLDivElement, RatingProps>(
  ({ value = 0, count, size = 'sm', showValue = true, showCount = true, max = 5, className, ...props }, ref) => {
    const clampedValue = Math.max(0, Math.min(max, value));
    const sizeConfig = sizeClasses[size];

    return (
      <div
        ref={ref}
        className={cn('inline-flex items-center', sizeConfig.gap, className)}
        role="img"
        aria-label={`Rating: ${clampedValue.toFixed(1)} out of ${max} stars${count !== undefined ? ` from ${count} reviews` : ''}`}
        {...props}
      >
        <div className="flex items-center">
          {Array.from({ length: max }).map((_, index) => {
            const fillLevel = Math.max(0, Math.min(1, clampedValue - index));

            return (
              <div key={index} className="relative inline-block">
                {/* Empty background star */}
                <Star className={cn(sizeConfig.star, 'text-slate-200 fill-slate-200')} />

                {/* Filled foreground star with clip-path */}
                {fillLevel > 0 && (
                  <div className="absolute top-0 left-0 overflow-hidden h-full" style={{ width: `${fillLevel * 100}%` }}>
                    <Star className={cn(sizeConfig.star, 'text-brand-gold fill-brand-gold')} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showValue && <span className={cn('font-semibold text-slate-700 ml-1', sizeConfig.text)}>{clampedValue.toFixed(1)}</span>}

        {showCount && count !== undefined && <span className={cn('text-slate-400 font-normal', sizeConfig.text)}>({count.toLocaleString()})</span>}
      </div>
    );
  }
);

Rating.displayName = 'Rating';

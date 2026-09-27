import * as React from 'react';
import { cn } from '../lib/utils';

export interface TrustBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icon element (e.g. Lucide icon) */
  icon: React.ReactNode;
  /** Primary badge title (e.g. "Free Delivery", "Secure Payment") */
  title: string;
  /** Secondary descriptive subtitle (e.g. "On orders over AED 150", "100% Protected") */
  subtitle?: string;
  /** Visual presentation style */
  variant?: 'card' | 'horizontal' | 'compact';
  /** Icon container style */
  iconVariant?: 'mint' | 'teal' | 'navy' | 'ghost';
}

const variantStyles = {
  card: 'flex flex-col items-center text-center p-5 rounded-2xl bg-white border border-slate-100 shadow-[0_2px_12px_-2px_rgba(11,25,44,0.05)] transition-all duration-200 hover:shadow-md hover:border-slate-200',
  horizontal: 'flex items-center gap-3.5 p-3 rounded-xl',
  compact: 'flex items-center gap-2.5 text-left',
};

const iconContainerStyles = {
  mint: 'bg-[#F0FDF4] text-[#10B981] border border-[#DCFCE7]',
  teal: 'bg-[#F0FDFA] text-[#0D9488] border border-[#CCFBF1]',
  navy: 'bg-[#0B192C]/5 text-[#0B192C] border border-[#0B192C]/10',
  ghost: 'bg-transparent text-current border-0',
};

/**
 * TrustBadge Component
 * Displays a value proposition badge with icon, title, and optional subtitle.
 *
 * Example usage:
 * ```tsx
 * <TrustBadge
 *   icon={<Truck className="w-5 h-5" />}
 *   title="Free Delivery"
 *   subtitle="On orders above AED 150"
 *   variant="horizontal"
 * />
 * ```
 */
export const TrustBadge = React.forwardRef<HTMLDivElement, TrustBadgeProps>(
  ({ icon, title, subtitle, variant = 'horizontal', iconVariant = 'teal', className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn(variantStyles[variant], className)} {...props}>
        <div
          className={cn(
            'flex items-center justify-center shrink-0 rounded-xl transition-transform duration-200 group-hover:scale-105',
            variant === 'card' ? 'w-12 h-12 mb-3' : 'w-10 h-10',
            iconContainerStyles[iconVariant]
          )}
        >
          {icon}
        </div>

        <div className={cn(variant === 'card' ? 'w-full' : 'flex-1 min-w-0')}>
          <h4 className="text-sm font-semibold text-[#0B192C] tracking-tight leading-snug">{title}</h4>
          {subtitle && <p className="text-xs text-slate-500 font-normal mt-0.5 leading-relaxed truncate">{subtitle}</p>}
        </div>
      </div>
    );
  }
);

TrustBadge.displayName = 'TrustBadge';

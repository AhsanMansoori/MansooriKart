import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-slate-100 text-slate-800',
        primary: 'border-transparent bg-brand-mint text-white shadow-xs',
        mint: 'border-transparent bg-surface-mint text-brand-teal-dark font-bold',
        teal: 'border-transparent bg-surface-teal text-brand-teal font-bold',
        discount: 'border-transparent bg-brand-red text-white font-extrabold shadow-xs tracking-tight',
        bestseller: 'border-transparent bg-brand-gold text-brand-navy-dark font-bold shadow-xs',
        new: 'border-transparent bg-brand-teal text-white font-bold shadow-xs',
        navy: 'border-transparent bg-brand-navy text-white font-medium',
        outline: 'border border-slate-200 text-slate-700 bg-white',
      },
      size: {
        sm: 'px-2 py-0.2 text-[10px]',
        md: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

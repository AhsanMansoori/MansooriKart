import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-slate-100 text-slate-800',
        primary: 'border-transparent bg-emerald-500 text-white shadow-xs',
        mint: 'border-transparent bg-emerald-50 text-emerald-700 font-bold',
        teal: 'border-transparent bg-teal-50 text-teal-700 font-bold',
        discount: 'border-transparent bg-rose-500 text-white font-extrabold shadow-xs tracking-tight',
        bestseller: 'border-transparent bg-amber-400 text-amber-950 font-bold shadow-xs',
        new: 'border-transparent bg-teal-600 text-white font-bold shadow-xs',
        navy: 'border-transparent bg-[#0B192C] text-white font-medium',
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

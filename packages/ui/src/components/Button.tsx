import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-r from-teal-600 via-emerald-500 to-teal-500 text-white shadow-[0_4px_14px_0_rgba(16,185,129,0.39)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.45)] hover:brightness-105 active:brightness-95 border-0',
        secondary: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100/90 border border-emerald-200/60 shadow-sm',
        outline: 'border-2 border-slate-200 bg-white text-slate-800 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50/40 shadow-xs',
        ghost: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-0',
        navy: 'bg-[#0B192C] text-white hover:bg-[#152238] shadow-md border-0',
        gold: 'bg-amber-500 text-white hover:bg-amber-600 shadow-[0_4px_14px_0_rgba(245,158,11,0.35)] border-0',
      },
      size: {
        sm: 'h-9 px-3.5 text-xs rounded-lg gap-1.5',
        md: 'h-11 px-5 text-sm rounded-xl gap-2',
        lg: 'h-13 px-7 text-base rounded-2xl gap-2.5',
        icon: 'h-10 w-10 p-0 rounded-full',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, isLoading, children, disabled, ...props }, ref) => {
    return (
      <button ref={ref} className={cn(buttonVariants({ variant, size, fullWidth, className }))} disabled={disabled || isLoading} {...props}>
        {isLoading ? (
          <span className="inline-flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>Loading...</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

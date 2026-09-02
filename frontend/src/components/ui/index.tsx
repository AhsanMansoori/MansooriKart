import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, PropsWithChildren, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';

const cn = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex min-h-10 items-center justify-center rounded-mk bg-navy px-4 font-semibold text-white transition hover:bg-deep-navy disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    />
  );
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('min-h-10 w-full rounded-mk border border-border bg-surface px-3 text-text placeholder:text-muted focus:border-gold', className)}
      {...props}
    />
  );
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn('w-full rounded-mk border border-border bg-surface px-3 py-2 text-text placeholder:text-muted focus:border-gold', className)}
      {...props}
    />
  );
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('min-h-10 w-full rounded-mk border border-border bg-surface px-3 text-text', className)} {...props} />;
}
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-deep-navy', className)} {...props} />;
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-mk bg-surface shadow-mk', className)} {...props} />;
}
export function Container({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
}
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <LoaderCircle className="animate-spin text-gold" aria-label={label} />;
}
export function Alert({ children, className, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div role="alert" className={cn('rounded-mk border border-border bg-canvas p-3 text-sm text-text', className)} {...props}>
      {children}
    </div>
  );
}
export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="rounded-mk border border-dashed border-border p-8 text-center">
      <h2 className="font-bold text-text">{title}</h2>
      {children}
    </div>
  );
}

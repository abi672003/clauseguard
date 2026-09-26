import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/format';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-[rgb(var(--accent-rgb)/0.16)] text-accent border-[rgb(var(--accent-rgb)/0.42)] hover:bg-[rgb(var(--accent-rgb)/0.26)]',
  secondary: 'bg-surface text-text border-border hover:bg-[rgb(var(--surface-rgb)/0.09)]',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-surface hover:text-text',
  danger:
    'bg-[rgb(var(--ungrounded-rgb)/0.14)] text-ungrounded border-[rgb(var(--ungrounded-rgb)/0.4)] hover:bg-[rgb(var(--ungrounded-rgb)/0.24)]',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconLeft,
    iconRight,
    block = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border font-medium',
        'transition-colors duration-240 ease-instrument',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      ) : (
        iconLeft
      )}
      {children && <span className="truncate">{children}</span>}
      {!loading && iconRight}
    </button>
  );
});

export default Button;

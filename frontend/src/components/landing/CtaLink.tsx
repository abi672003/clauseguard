import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/format';

export type CtaVariant = 'primary' | 'secondary';

export interface CtaLinkProps {
  to: string;
  children: ReactNode;
  variant?: CtaVariant;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  className?: string;
}

/** Router link dressed as a Button — Button renders a <button>, a CTA must navigate. */
const VARIANT: Record<CtaVariant, string> = {
  primary:
    'border-[rgb(var(--accent-rgb)/0.42)] bg-[rgb(var(--accent-rgb)/0.16)] text-accent hover:bg-[rgb(var(--accent-rgb)/0.26)]',
  secondary: 'border-border bg-surface text-text hover:bg-[rgb(var(--surface-rgb)/0.09)]',
};

export default function CtaLink({
  to,
  children,
  variant = 'secondary',
  iconLeft,
  iconRight,
  className,
}: CtaLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium',
        'transition-colors duration-240 ease-instrument',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        VARIANT[variant],
        className,
      )}
    >
      {iconLeft}
      <span className="truncate">{children}</span>
      {iconRight}
    </Link>
  );
}

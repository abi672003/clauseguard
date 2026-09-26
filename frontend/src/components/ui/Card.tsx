import type { ReactNode } from 'react';

import { cn } from '@/lib/format';

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Rendered top-right — buttons, filters, a verdict chip. */
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Set false when the child owns its own padding (tables, canvases). */
  padded?: boolean;
  as?: 'div' | 'section' | 'article';
}

/** The glass panel every screen is built from. */
export default function Card({
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
  bodyClassName,
  padded = true,
  as: Tag = 'section',
}: CardProps) {
  const hasHeader = Boolean(title || subtitle || actions);

  return (
    <Tag className={cn('glass flex min-w-0 flex-col overflow-hidden', className)}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-sm font-semibold tracking-tight text-text">{title}</h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}

      <div className={cn('min-w-0 flex-1', padded && 'p-4 sm:p-5', bodyClassName)}>{children}</div>

      {footer && (
        <footer className="border-t border-border px-4 py-3 text-xs text-muted sm:px-5">
          {footer}
        </footer>
      )}
    </Tag>
  );
}

import type { ReactNode } from 'react';

import { cn } from '@/lib/format';

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'grounded'
  | 'uncertain'
  | 'ungrounded'
  | 'muted';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Monospace for IDs, scores and counts. */
  mono?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
  title?: string;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface text-text',
  muted: 'border-border bg-surface text-muted',
  accent: 'border-[rgb(var(--accent-rgb)/0.35)] bg-[rgb(var(--accent-rgb)/0.12)] text-accent',
  grounded:
    'border-[rgb(var(--grounded-rgb)/0.35)] bg-[rgb(var(--grounded-rgb)/0.12)] text-grounded',
  uncertain:
    'border-[rgb(var(--uncertain-rgb)/0.35)] bg-[rgb(var(--uncertain-rgb)/0.12)] text-uncertain',
  ungrounded:
    'border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.12)] text-ungrounded',
};

const SIZE: Record<NonNullable<BadgeProps['size']>, string> = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2 py-0.5 text-[11px]',
};

export default function Badge({
  children,
  tone = 'neutral',
  mono = false,
  size = 'sm',
  className,
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-full border font-medium leading-none',
        TONE[tone],
        SIZE[size],
        mono && 'font-mono tabular-nums',
        className,
      )}
    >
      {children}
    </span>
  );
}

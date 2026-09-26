import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';

export type StatTone = 'neutral' | 'accent' | 'grounded' | 'uncertain' | 'ungrounded';

export interface StatTileProps {
  label: string;
  /** Pre-formatted — pass through format helpers, never a raw float. */
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  loading?: boolean;
  className?: string;
}

const TONE: Record<StatTone, string> = {
  neutral: 'text-text',
  accent: 'text-accent',
  grounded: 'text-grounded',
  uncertain: 'text-uncertain',
  ungrounded: 'text-ungrounded',
};

/** A single KPI. Numbers are monospace and tabular by house rule. */
export default function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  loading = false,
  className,
}: StatTileProps) {
  return (
    <div className={cn('glass flex min-w-0 flex-col gap-2 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          {label}
        </span>
        {Icon && <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', TONE[tone])} />}
      </div>

      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <span
          className={cn(
            'font-mono text-2xl font-semibold leading-none tabular-nums',
            TONE[tone],
          )}
        >
          {value}
        </span>
      )}

      {hint && !loading && <span className="truncate text-xs text-muted">{hint}</span>}
    </div>
  );
}

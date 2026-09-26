import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/format';

export interface EmptyStateProps {
  /** Say what is missing. */
  title: string;
  /** Say what the user should do next — never just "no data". */
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
  className?: string;
}

export default function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  tone = 'neutral',
  className,
}: EmptyStateProps) {
  const isError = tone === 'error';

  return (
    <div
      role={isError ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-5 py-10 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full border',
          isError
            ? 'border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.1)] text-ungrounded'
            : 'border-border bg-surface text-muted',
        )}
      >
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>

      <div className="max-w-sm space-y-1">
        <p className={cn('text-sm font-semibold', isError ? 'text-ungrounded' : 'text-text')}>
          {title}
        </p>
        {description && <p className="text-xs leading-relaxed text-muted">{description}</p>}
      </div>

      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

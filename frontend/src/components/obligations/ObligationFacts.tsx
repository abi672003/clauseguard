/**
 * The trackable facts — the part of the obligation a calendar, an alert or a
 * finance system would consume. Anything the extractor could not find is shown
 * as absent rather than guessed at.
 */
import { AlertTriangle, CalendarClock } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import { Fact } from '@/components/obligations/PanelStates';
import { SEVERITY_META, isOverdue, typeLabel } from '@/components/obligations/tokens';
import {
  EMPTY,
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeDate,
} from '@/lib/format';
import type { ObligationDetail } from '@/lib/types';

export interface ObligationFactsProps {
  obligation: ObligationDetail;
}

export default function ObligationFacts({ obligation }: ObligationFactsProps) {
  const severity = SEVERITY_META[obligation.severity];
  const overdue = isOverdue(obligation.due_date, obligation.status);

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3',
          overdue
            ? 'border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.08)]'
            : 'border-border bg-surface',
        )}
      >
        {overdue ? (
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-ungrounded" />
        ) : (
          <CalendarClock aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
        )}
        <span className="font-mono text-sm tabular-nums text-text">
          {obligation.due_date ? formatDate(obligation.due_date) : 'No due date extracted'}
        </span>
        {obligation.due_date && (
          <span className={cn('text-xs', overdue ? 'text-ungrounded' : 'text-muted')}>
            {overdue ? 'Overdue' : formatRelativeDate(obligation.due_date)}
          </span>
        )}
        {obligation.due_date_basis && (
          <span className="text-xs text-muted">
            basis:{' '}
            <span className="font-mono text-text">{obligation.due_date_basis}</span>
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-4">
        <Fact label="Obligor">{obligation.obligor ?? EMPTY}</Fact>
        <Fact label="Obligee">{obligation.obligee ?? EMPTY}</Fact>
        <Fact label="Type">{typeLabel(obligation.obligation_type)}</Fact>
        <Fact label="Severity">
          <Badge tone={severity.tone} size="xs">
            {severity.label}
          </Badge>
        </Fact>
        <Fact label="Recurrence">{obligation.recurrence ?? 'One-off'}</Fact>
        <Fact label="Notice period" mono>
          {obligation.notice_period_days === null
            ? EMPTY
            : `${formatNumber(obligation.notice_period_days)} days`}
        </Fact>
        <Fact label="Monetary amount" mono>
          {obligation.monetary_amount === null
            ? EMPTY
            : formatCurrency(obligation.monetary_amount, obligation.currency)}
        </Fact>
        <Fact label="Extracted" mono>
          {formatDateTime(obligation.created_at)}
        </Fact>
      </dl>
    </div>
  );
}

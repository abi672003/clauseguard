import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, ArrowRight, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import VerdictChip from '@/components/ui/VerdictChip';
import { getReviewQueue } from '@/lib/api';
import { formatNumber, formatRelativeDate, humanize, truncate } from '@/lib/format';

const QUEUE_LIMIT = 5;

function QueueSkeleton() {
  return (
    <ul role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">Loading the review queue</span>
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}

/**
 * The five oldest open escalations — the claims the verifier would not vouch
 * for. Each one links into the review queue where it can be adjudicated.
 */
export default function EscalationsPanel() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['review', 'queue', { state: 'open', limit: QUEUE_LIMIT }],
    queryFn: () => getReviewQueue({ state: 'open', limit: QUEUE_LIMIT }),
  });

  const items = data?.items ?? [];
  const open = data?.total ?? 0;

  return (
    <Card
      title="Recent escalations"
      subtitle="Claims the verifier refused to auto-track"
      actions={
        open > 0 ? (
          <Badge tone="uncertain" mono size="sm">
            {formatNumber(open)} open
          </Badge>
        ) : undefined
      }
      footer={
        <Link
          to="/review"
          className="inline-flex items-center gap-1.5 font-medium text-accent underline-offset-4 hover:underline"
        >
          Open the review queue
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </Link>
      }
    >
      {isPending ? (
        <QueueSkeleton />
      ) : isError ? (
        <EmptyState
          tone="error"
          icon={AlertOctagon}
          title={error instanceof Error ? error.message : 'Could not load the review queue'}
          description="Escalations are read live from /review/queue."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing is waiting on a human"
          description="Every extracted obligation either cleared entailment against its clause or was rejected outright."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((task) => {
            const obligation = task.obligation;
            return (
              <li key={task.id}>
                <Link
                  to="/review"
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3 transition-colors duration-240 ease-instrument hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
                      {obligation ? obligation.title : `Task ${task.id}`}
                    </span>
                    {obligation?.verification ? (
                      <VerdictChip
                        verdict={obligation.verification.verdict}
                        score={obligation.verification.entailment}
                        size="xs"
                        showLabel={false}
                      />
                    ) : (
                      <Badge tone="muted" size="xs">
                        No verdict
                      </Badge>
                    )}
                  </div>

                  <p className="text-[11px] leading-relaxed text-muted">
                    {truncate(task.reason, 140)}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                    <span className="font-mono tabular-nums">P{task.priority}</span>
                    {obligation && (
                      <>
                        <span aria-hidden="true" className="h-3 w-px bg-border" />
                        <span>{humanize(obligation.obligation_type)}</span>
                        <span aria-hidden="true" className="h-3 w-px bg-border" />
                        <span className="min-w-0 truncate">
                          {obligation.contract_title ?? obligation.contract_id}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true" className="h-3 w-px bg-border" />
                    <span className="font-mono">{formatRelativeDate(task.created_at)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

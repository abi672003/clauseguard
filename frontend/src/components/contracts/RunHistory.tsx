import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, History, TriangleAlert } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { formatMs, numericCounts, stageTimings } from '@/components/contracts/helpers';
import { ApiError } from '@/lib/api';
import { cn, formatDateTime, formatNumber, humanize } from '@/lib/format';
import type { PipelineRunOut } from '@/lib/types';

export interface RunHistoryProps {
  runs: readonly PipelineRunOut[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function StageBar({ run }: { run: PipelineRunOut }) {
  const timings = stageTimings(run.stage_timings);
  const total = timings.reduce((sum, entry) => sum + entry.ms, 0);
  if (timings.length === 0 || total <= 0) {
    return (
      <p className="text-[11px] text-muted">No per-stage timings recorded for this run.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full border border-border">
        {timings.map((entry, index) => (
          <div
            key={entry.stage}
            title={`${entry.stage} — ${formatMs(entry.ms)}`}
            style={{
              width: `${(entry.ms / total) * 100}%`,
              // one token, stepped opacity: the bar stays inside the palette
              backgroundColor: `rgb(var(--accent-rgb) / ${(0.9 - (index % 5) * 0.14).toFixed(2)})`,
            }}
          />
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
        {timings.map((entry) => (
          <div key={entry.stage} className="flex items-baseline justify-between gap-2">
            <dt className="truncate text-[11px] uppercase tracking-wide text-muted">
              {entry.stage}
            </dt>
            <dd className="shrink-0 font-mono text-[11px] tabular-nums text-text">
              {formatMs(entry.ms)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Every analysis run this contract has been through, with stage timings. */
export default function RunHistory({ runs, loading = false, error, onRetry }: RunHistoryProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4 sm:p-5">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-9" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-5">
        <EmptyState
          tone="error"
          icon={TriangleAlert}
          title="Could not load the run history"
          description={error instanceof ApiError ? error.message : 'The runs endpoint did not respond.'}
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-4 sm:p-5">
        <EmptyState
          icon={History}
          title="No analysis runs yet"
          description="Run the pipeline with Re-analyze above — each run records its stage timings here, so verifier-on and verifier-off passes can be compared."
        />
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted">
            <th scope="col" className="w-8 px-3 py-2">
              <span className="sr-only">Expand</span>
            </th>
            <th scope="col" className="px-3 py-2 font-medium">Started</th>
            <th scope="col" className="px-3 py-2 font-medium">Verifier</th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Agent</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const open = expanded === run.id;
            const counts = numericCounts(run.counts);
            return (
              <Fragment key={run.id}>
                <tr
                  className={cn(
                    'cursor-pointer border-b border-border transition-colors duration-240 ease-instrument hover:bg-[rgb(var(--surface-rgb)/0.05)]',
                    open && 'bg-[rgb(var(--surface-rgb)/0.05)]',
                  )}
                  onClick={() => setExpanded(open ? null : run.id)}
                >
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={open ? 'Hide stage timings' : 'Show stage timings'}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        setExpanded(open ? null : run.id);
                      }}
                      className="rounded text-muted transition-colors duration-240 ease-instrument hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {open ? (
                        <ChevronDown aria-hidden="true" className="h-4 w-4" />
                      ) : (
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-text">
                    {formatDateTime(run.created_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={run.verifier_enabled ? 'grounded' : 'uncertain'} size="xs">
                      {run.verifier_enabled ? 'On' : 'Off'}
                    </Badge>
                  </td>
                  <td className="hidden px-3 py-2.5 font-mono text-xs text-muted sm:table-cell">
                    {run.agent_mode}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge
                      tone={
                        run.status === 'complete'
                          ? 'grounded'
                          : run.status === 'failed'
                            ? 'ungrounded'
                            : 'accent'
                      }
                      size="xs"
                      title={run.error ?? undefined}
                    >
                      {humanize(run.status)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-text">
                    {formatMs(run.total_ms)}
                  </td>
                </tr>

                {open && (
                  <tr className="border-b border-border">
                    <td colSpan={6} className="px-3 pb-4 pt-1 sm:px-5">
                      <div className="flex flex-col gap-3">
                        <StageBar run={run} />

                        {counts.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {counts.map(([key, value]) => (
                              <Badge key={key} tone="muted" size="xs" mono title={key}>
                                {key} {formatNumber(value)}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {run.error && (
                          <p
                            role="alert"
                            className="rounded-lg border border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.1)] p-2.5 font-mono text-[11px] text-ungrounded"
                          >
                            {run.error}
                          </p>
                        )}

                        <p className="font-mono text-[10px] text-muted">run {run.id}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

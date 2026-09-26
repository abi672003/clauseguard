import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { PlugZap, TriangleAlert } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import { openPipelineSocket } from '@/lib/api';
import { cn, formatPct, humanize } from '@/lib/format';
import { PIPELINE_STAGES } from '@/lib/types';
import type { ProgressEvent as PipelineProgressEvent } from '@/lib/types';

/** The signature scene is heavy — it only loads when an analysis is actually running. */
const PipelineFlowScene = lazy(() => import('@/components/three/PipelineFlow'));

type Connection = 'connecting' | 'open' | 'closed' | 'error';

export interface PipelineStreamProps {
  contractId: string;
  /** Fired when the stream reports `complete` or `failed`, so queries can refetch. */
  onFinished?: () => void;
  className?: string;
}

/**
 * Live analysis. This component owns the WebSocket from `openPipelineSocket`
 * and feeds the PipelineFlow scene: stage nodes fill as the run advances, and
 * the textual read-out underneath carries the same state for anyone who cannot
 * see the canvas.
 */
export default function PipelineStream({ contractId, onFinished, className }: PipelineStreamProps) {
  const [event, setEvent] = useState<PipelineProgressEvent | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    setEvent(null);
    setConnection('connecting');

    let socket: WebSocket | null = null;
    try {
      socket = openPipelineSocket(
        contractId,
        (message) => {
          setEvent(message);
          if (message.stage === 'complete' || message.stage === 'failed') {
            onFinishedRef.current?.();
          }
        },
        {
          onOpen: () => setConnection('open'),
          onClose: () => setConnection((previous) => (previous === 'error' ? previous : 'closed')),
          onError: () => setConnection('error'),
        },
      );
    } catch {
      setConnection('error');
    }

    return () => {
      socket?.close();
    };
  }, [contractId]);

  const stages = useMemo<string[]>(() => [...PIPELINE_STAGES], []);

  const activeStage = event?.stage ?? 'queued';
  const failed = activeStage === 'failed';
  const finished = activeStage === 'complete';
  const activeIndex = stages.indexOf(activeStage);

  const completed = useMemo<string[]>(() => {
    if (finished) return stages.slice();
    if (activeIndex <= 0) return [];
    return stages.slice(0, activeIndex);
  }, [activeIndex, finished, stages]);

  const pct = event ? Math.min(1, Math.max(0, event.pct)) : 0;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={failed ? 'ungrounded' : finished ? 'grounded' : 'accent'} mono size="sm">
            {humanize(activeStage)}
          </Badge>
          <p className="min-w-0 truncate text-xs text-muted" title={event?.message}>
            {event?.message ?? 'Waiting for the first progress frame…'}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-text">
          {formatPct(pct, 0)}
        </span>
      </div>

      <Suspense fallback={<Skeleton className="h-[200px] w-full" rounded="lg" />}>
        <PipelineFlowScene
          stages={stages}
          activeStage={activeStage}
          completed={completed}
          className="h-[200px] w-full sm:h-[240px]"
        />
      </Suspense>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-label={`Analysis progress — ${humanize(activeStage)}`}
        className="h-1 w-full overflow-hidden rounded-full bg-[rgb(var(--surface-rgb)/0.08)]"
      >
        <div
          className="h-full rounded-full transition-[width] duration-420 ease-instrument"
          style={{
            width: `${pct * 100}%`,
            backgroundColor: failed ? 'var(--ungrounded)' : 'var(--accent)',
          }}
        />
      </div>

      {failed && event && (
        <p role="alert" className="flex items-start gap-2 text-[11px] text-ungrounded">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{event.message}</span>
        </p>
      )}

      {connection === 'error' && (
        <p role="status" className="flex items-center gap-2 text-[11px] text-uncertain">
          <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Live stream unavailable — this screen falls back to polling every three seconds.
        </p>
      )}

      {connection === 'connecting' && !event && (
        <p role="status" className="flex items-center gap-2 text-[11px] text-muted">
          <PlugZap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Opening the pipeline stream…
        </p>
      )}
    </div>
  );
}

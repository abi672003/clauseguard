import { Suspense, lazy, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, Orbit } from 'lucide-react';

import { ChartLegend, VERDICT_SERIES } from '@/components/dashboard/chart-kit';
import type { ConstellationPoint } from '@/components/three/ObligationConstellation';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { listObligations } from '@/lib/api';
import { daysUntil, formatNumber } from '@/lib/format';

/** three.js is lazy so it never lands in the initial bundle. */
const ConstellationScene = lazy(() => import('@/components/dashboard/ConstellationScene'));

/** One page deep enough to be the whole register on any realistic corpus. */
const POINT_LIMIT = 500;

function SceneSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full w-full items-center justify-center p-4"
    >
      <span className="sr-only">Loading the obligation constellation</span>
      <Skeleton className="h-full w-full" rounded="lg" />
    </div>
  );
}

export default function ConstellationPanel() {
  const navigate = useNavigate();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['obligations', 'constellation', POINT_LIMIT],
    queryFn: () => listObligations({ limit: POINT_LIMIT }),
  });

  // x = entailment · y = days until due · z = severity · colour = verdict.
  // Claims with no verification record have no x, so they are not plotted —
  // the footer says how many were left out rather than inventing a score.
  const points = useMemo<ConstellationPoint[]>(() => {
    if (!data) return [];
    return data.items.flatMap((obligation) => {
      const verification = obligation.verification;
      if (!verification) return [];
      return [
        {
          id: obligation.id,
          title: obligation.title,
          verdict: verification.verdict,
          entailment: verification.entailment,
          daysUntilDue: daysUntil(obligation.due_date),
          severity: obligation.severity,
        },
      ];
    });
  }, [data]);

  const handleSelect = useCallback(
    (obligationId: string) => {
      navigate(`/obligations/${obligationId}`);
    },
    [navigate],
  );

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const point of points) tally.set(point.verdict, (tally.get(point.verdict) ?? 0) + 1);
    return tally;
  }, [points]);

  const unplotted = data ? data.items.length - points.length : 0;
  const truncated = data ? Math.max(0, data.total - data.items.length) : 0;

  return (
    <Card
      title="Obligation constellation"
      subtitle="x entailment · y days to due · z severity — click a point to open it"
      padded={false}
      className="min-w-0"
    >
      <div className="h-[340px] w-full sm:h-[420px] lg:h-[480px]">
        {isPending ? (
          <SceneSkeleton />
        ) : isError ? (
          <div className="flex h-full items-center justify-center p-4">
            <EmptyState
              tone="error"
              icon={AlertOctagon}
              title={error instanceof Error ? error.message : 'Could not load obligations'}
              description="The constellation plots live obligations — nothing is drawn until the API answers."
            />
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <EmptyState
              icon={Orbit}
              title="No verified obligations to plot"
              description="Each point is one obligation positioned by its entailment score. Analyse a contract with the verifier enabled and they appear here."
            />
          </div>
        ) : (
          <Suspense fallback={<SceneSkeleton />}>
            <ConstellationScene points={points} onSelect={handleSelect} />
          </Suspense>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3 sm:px-5">
        <ChartLegend
          items={VERDICT_SERIES.map((series) => ({
            key: series.key,
            label: series.label,
            color: series.color,
            value: formatNumber(counts.get(series.verdict) ?? 0),
          }))}
        />
        <p className="text-[11px] text-muted">
          <span className="font-mono tabular-nums text-text">{formatNumber(points.length)}</span>{' '}
          plotted
          {unplotted > 0 && (
            <>
              {' · '}
              <span className="font-mono tabular-nums text-text">{formatNumber(unplotted)}</span>{' '}
              without an entailment record
            </>
          )}
          {truncated > 0 && (
            <>
              {' · '}
              <span className="font-mono tabular-nums text-text">
                {formatNumber(truncated)}
              </span>{' '}
              beyond the first {formatNumber(POINT_LIMIT)}
            </>
          )}
        </p>
      </div>
    </Card>
  );
}

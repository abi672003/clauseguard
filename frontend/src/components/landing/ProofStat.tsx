import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FlaskConical, TriangleAlert } from 'lucide-react';

import CtaLink from '@/components/landing/CtaLink';
import Skeleton from '@/components/ui/Skeleton';
import { getAblation } from '@/lib/api';
import { formatDate, formatNumber, formatPct } from '@/lib/format';
import type { AblationArm, AblationReport } from '@/lib/types';

/**
 * The live proof: the verifier-off vs verifier-on false-obligation rate from the
 * most recent ablation run. Nothing here is hardcoded — if no ablation has been
 * run, the panel says so and points at /research.
 */

/** Metric names the ablation may publish the false-obligation rate under. */
const RATE_KEYS = ['false_obligation_rate', 'false_obligation', 'hallucination_rate'] as const;

function pickRate(metrics: Record<string, number>): number | null {
  for (const key of RATE_KEYS) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (key.includes('false') && Number.isFinite(value)) return value;
  }
  return null;
}

/** The backend may publish rates as 0–1 or as 0–100; normalise to a fraction. */
function asFraction(value: number): number {
  return value > 1 ? value / 100 : value;
}

function newest(reports: AblationReport[]): AblationReport | null {
  if (reports.length === 0) return null;
  return reports.reduce((best, report) =>
    Date.parse(report.created_at) > Date.parse(best.created_at) ? report : best,
  );
}

function armOf(report: AblationReport, arm: AblationArm['arm']): AblationArm | undefined {
  return report.arms.find((candidate) => candidate.arm === arm);
}

interface Delta {
  off: number;
  on: number;
  samples: number;
  report: AblationReport;
}

function readDelta(reports: AblationReport[]): Delta | null {
  const report = newest(reports);
  if (!report) return null;

  const off = armOf(report, 'verifier_off');
  const on = armOf(report, 'verifier_on');
  if (!off || !on) return null;

  const offRate = pickRate(off.metrics);
  const onRate = pickRate(on.metrics);
  if (offRate === null || onRate === null) return null;

  return {
    off: asFraction(offRate),
    on: asFraction(onRate),
    samples: Math.max(off.n_samples, on.n_samples),
    report,
  };
}

/* ------------------------------------------------------------------ shell */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="glass w-full max-w-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 pb-3">
        <FlaskConical aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent" />
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
          False obligations blocked
        </h2>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ panel */
export default function ProofStat() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['analytics', 'ablation'],
    queryFn: getAblation,
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <Shell>
        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          <span className="sr-only">Loading the latest ablation result</span>
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
      </Shell>
    );
  }

  if (isError) {
    return (
      <Shell>
        <div role="alert" className="flex flex-col gap-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-ungrounded">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {error instanceof Error ? error.message : 'The ablation endpoint is unreachable.'}
            </span>
          </p>
          <p className="text-xs leading-relaxed text-muted">
            The proof stat is read live from <code className="text-[11px]">/analytics/ablation</code>{' '}
            — it is never baked into the page.
          </p>
        </div>
      </Shell>
    );
  }

  const delta = readDelta(data ?? []);

  if (!delta) {
    return (
      <Shell>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-text">
            No ablation has been run against this deployment yet.
          </p>
          <p className="text-xs leading-relaxed text-muted">
            This number is measured, not claimed. Run the verifier-on / verifier-off comparison and
            it appears here.
          </p>
          <CtaLink
            to="/research"
            variant="primary"
            className="self-start"
            iconRight={<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />}
          >
            Run the ablation
          </CtaLink>
        </div>
      </Shell>
    );
  }

  const pointsDropped = (delta.off - delta.on) * 100;
  const relative = delta.off > 0 ? (delta.off - delta.on) / delta.off : null;

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-3xl font-semibold leading-none text-ungrounded sm:text-4xl">
            {formatPct(delta.off)}
          </span>
          <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0 text-muted" />
          <span className="font-mono text-3xl font-semibold leading-none text-grounded sm:text-4xl">
            {formatPct(delta.on)}
          </span>
          <span className="sr-only">
            false-obligation rate falls from {formatPct(delta.off)} without the verifier to{' '}
            {formatPct(delta.on)} with it
          </span>
        </p>

        <p className="text-xs leading-relaxed text-muted">
          Verifier off → verifier on.{' '}
          <span className="font-mono tabular-nums text-text">
            {pointsDropped >= 0 ? '−' : '+'}
            {Math.abs(pointsDropped).toFixed(1)} pp
          </span>
          {relative !== null && (
            <>
              {' · '}
              <span className="font-mono tabular-nums text-text">{formatPct(relative, 0)}</span>{' '}
              fewer false obligations
            </>
          )}
        </p>

        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-muted">
          <div className="flex items-center gap-1.5">
            <dt>Dataset</dt>
            <dd className="font-mono text-text">{delta.report.dataset}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>n</dt>
            <dd className="font-mono tabular-nums text-text">{formatNumber(delta.samples)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>Run</dt>
            <dd className="truncate font-mono text-text">{delta.report.run_label}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Measured</dt>
            <dd className="font-mono tabular-nums">{formatDate(delta.report.created_at)}</dd>
          </div>
        </dl>
      </div>
    </Shell>
  );
}

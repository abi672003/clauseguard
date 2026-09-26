/**
 * /research — the evidence for the novelty claim.
 *
 * Two questions, answered with the backend's own numbers: does the verifier
 * actually cut false obligations (the ablation), and was the threshold chosen
 * or merely inherited (the calibration sweep). Nothing here is illustrative.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, ShieldCheck, ShieldOff, TrendingDown } from 'lucide-react';

import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import StatTile from '@/components/ui/StatTile';
import AblationChart from '@/components/research/AblationChart';
import AblationTable from '@/components/research/AblationTable';
import CalibrationChart from '@/components/research/CalibrationChart';
import Methodology from '@/components/research/Methodology';
import RunAblationPanel from '@/components/research/RunAblationPanel';
import { ARM_META, improvement } from '@/components/research/metrics';
import { ErrorPanel } from '@/components/obligations/PanelStates';
import { getAblation, getAblationStatus, getCalibration, runAblation } from '@/lib/api';
import { EMPTY, formatDateTime, formatPct } from '@/lib/format';
import type { AblationArmName, AblationReport } from '@/lib/types';

const HEADLINE = 'false_obligation_rate';

function metricOf(
  report: AblationReport | null,
  arm: AblationArmName,
  key: string,
): number | undefined {
  return report?.arms.find((candidate) => candidate.arm === arm)?.metrics[key];
}

function deltaOf(report: AblationReport | null, key: string): number | undefined {
  if (!report) return undefined;
  const reported = report.delta[key];
  if (typeof reported === 'number' && Number.isFinite(reported)) return reported;
  const on = metricOf(report, 'verifier_on', key);
  const off = metricOf(report, 'verifier_off', key);
  return typeof on === 'number' && typeof off === 'number' ? on - off : undefined;
}

export default function Research() {
  const queryClient = useQueryClient();
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  // The run endpoint returns a 202 receipt in milliseconds while the job takes
  // minutes, so completion has to be observed rather than assumed.
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const ablation = useQuery({
    queryKey: ['research', 'ablation'],
    queryFn: getAblation,
  });

  const calibration = useQuery({
    queryKey: ['research', 'calibration'],
    queryFn: getCalibration,
  });

  const reports = useMemo(
    () => [...(ablation.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [ablation.data],
  );

  const report =
    reports.find((candidate) => candidate.run_label === selectedLabel) ?? reports[0] ?? null;

  const run = useMutation({
    mutationFn: (nSamples: number) => runAblation({ n_samples: nSamples }),
    onSuccess: (receipt) => setPendingLabel(receipt.run_label),
  });

  const status = useQuery({
    queryKey: ['research', 'ablation-status'],
    queryFn: getAblationStatus,
    enabled: pendingLabel !== null,
    refetchInterval: pendingLabel !== null ? 2000 : false,
  });

  // The job is done when the server stops reporting it as running.
  useEffect(() => {
    if (pendingLabel === null || !status.data || status.data.running) return;
    setSelectedLabel(pendingLabel);
    setPendingLabel(null);
    void queryClient.invalidateQueries({ queryKey: ['research', 'ablation'] });
  }, [pendingLabel, status.data, queryClient]);

  const busy = run.isPending || pendingLabel !== null;

  const handleRun = useCallback((nSamples: number) => run.mutate(nSamples), [run]);

  const onRate = metricOf(report, 'verifier_on', HEADLINE);
  const offRate = metricOf(report, 'verifier_off', HEADLINE);
  const rateDelta = deltaOf(report, HEADLINE);
  const f1Delta = deltaOf(report, 'f1');
  const loadingHeadline = ablation.isPending;
  /** Never let a failed fetch read as a measured zero. */
  const hint = (text: string) => (ablation.isError ? 'Report unavailable' : text);

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <header className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-text">Research</h1>
        <p className="mt-0.5 max-w-3xl text-xs text-muted">
          ClauseGuard's claim is narrow and testable: re-checking every extracted obligation against
          its source clause removes obligations the contract never created. This screen is the
          measurement, not the pitch — the ablation, the threshold sweep, and the protocol behind
          both.
        </p>
      </header>

      {/* ------------------------------------------------------ headline tiles */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="False obligations · ON"
          loading={loadingHeadline}
          tone="grounded"
          icon={ShieldCheck}
          value={onRate === undefined ? EMPTY : formatPct(onRate)}
          hint={hint('Verifier in the loop')}
        />
        <StatTile
          label="False obligations · OFF"
          loading={loadingHeadline}
          tone="ungrounded"
          icon={ShieldOff}
          value={offRate === undefined ? EMPTY : formatPct(offRate)}
          hint={hint('Extractor trusted as-is')}
        />
        <StatTile
          label="Δ false obligations"
          loading={loadingHeadline}
          tone={
            rateDelta === undefined
              ? 'neutral'
              : improvement(HEADLINE, rateDelta) === 'better'
                ? 'grounded'
                : improvement(HEADLINE, rateDelta) === 'worse'
                  ? 'ungrounded'
                  : 'neutral'
          }
          icon={TrendingDown}
          value={
            rateDelta === undefined ? EMPTY : `${rateDelta > 0 ? '+' : ''}${formatPct(rateDelta)}`
          }
          hint={hint('ON minus OFF — the novelty claim')}
        />
        <StatTile
          label="Δ F1"
          loading={loadingHeadline}
          tone={
            f1Delta === undefined
              ? 'neutral'
              : improvement('f1', f1Delta) === 'better'
                ? 'grounded'
                : 'uncertain'
          }
          icon={FlaskConical}
          value={f1Delta === undefined ? EMPTY : `${f1Delta > 0 ? '+' : ''}${formatPct(f1Delta)}`}
          hint={hint('What the filtering costs, or earns')}
        />
      </div>

      {/* --------------------------------------------------------- run control */}
      <Card
        title="Run the ablation"
        subtitle="Scores both arms over a labelled sample and files a new report"
        actions={
          reports.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              Run
              <select
                value={report?.run_label ?? ''}
                onChange={(event) => setSelectedLabel(event.target.value)}
                className="h-8 max-w-[180px] rounded-lg border border-border bg-bg-elev px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {reports.map((candidate) => (
                  <option key={candidate.run_label} value={candidate.run_label}>
                    {candidate.run_label}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      >
        <RunAblationPanel
          onRun={handleRun}
          running={busy}
          error={run.isError ? run.error : (status.data?.error ?? null)}
          progress={status.data?.progress ?? 0}
          stage={status.data?.stage ?? ''}
          finishedLabel={!busy && run.isSuccess ? selectedLabel : null}
        />
      </Card>

      {/* ---------------------------------------------------------- comparison */}
      <Card
        title="Verifier ON vs verifier OFF"
        subtitle={
          report
            ? `${report.run_label} · ${report.dataset} · ${formatDateTime(report.created_at)}`
            : 'No run selected'
        }
        actions={
          <div className="hidden items-center gap-3 sm:flex">
            {(['verifier_on', 'verifier_off'] as const).map((arm) => (
              <span key={arm} className="flex items-center gap-1.5 text-[11px] text-muted">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: ARM_META[arm].color }}
                />
                {ARM_META[arm].label}
              </span>
            ))}
          </div>
        }
      >
        {ablation.isPending ? (
          <Skeleton className="h-[320px]" rounded="lg" />
        ) : ablation.isError ? (
          <ErrorPanel
            error={ablation.error}
            what="the ablation report"
            onRetry={() => void ablation.refetch()}
          />
        ) : !report ? (
          <EmptyState
            icon={FlaskConical}
            title="No ablation has been run yet"
            description="Run one above — a few hundred samples is enough to see the direction. Until then there is nothing to compare, and no claim worth making."
          />
        ) : (
          <div className="flex flex-col gap-5">
            <AblationChart report={report} />
            <div className="border-t border-border pt-4">
              <AblationTable report={report} />
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              Both arms process the identical extractions; the only difference is whether the
              entailment check may veto one. A negative Δ on the false-obligation rate is the result
              the product is built on — the rest of the table is the price paid for it.
            </p>
          </div>
        )}
      </Card>

      {/* --------------------------------------------------------- calibration */}
      <Card
        title="Threshold calibration"
        subtitle={
          calibration.data
            ? `Sweep of ${calibration.data.curve.length} candidate thresholds · in force ${calibration.data.threshold.toFixed(2)}`
            : 'Where the operating point came from'
        }
      >
        {calibration.isPending ? (
          <Skeleton className="h-[320px]" rounded="lg" />
        ) : calibration.isError ? (
          <ErrorPanel
            error={calibration.error}
            what="the calibration curve"
            onRetry={() => void calibration.refetch()}
          />
        ) : (
          <CalibrationChart report={calibration.data} />
        )}
      </Card>

      {/* --------------------------------------------------------- methodology */}
      <Card title="Methodology" subtitle="What was measured, on what, and what it licenses">
        <Methodology report={report} />
      </Card>
    </div>
  );
}

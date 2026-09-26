/**
 * The same comparison as numbers, including the metrics the chart cannot plot.
 * The delta column is the claim under test, so it is the loud one: signed,
 * direction-aware (an error rate improves by going down) and colour-coded.
 */
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import EmptyState from '@/components/ui/EmptyState';
import { ARM_META, improvement, metricMeta, orderMetrics } from '@/components/research/metrics';
import { cn, formatNumber, formatPct } from '@/lib/format';
import type { AblationReport } from '@/lib/types';

export interface AblationTableProps {
  report: AblationReport;
}

/** Colour says better or worse; the arrow says which way the number moved. */
const DELTA_TONE = {
  better: 'text-grounded',
  worse: 'text-ungrounded',
  flat: 'text-muted',
} as const;

function deltaIcon(delta: number | undefined) {
  if (delta === undefined || Math.abs(delta) < 1e-6) return Minus;
  return delta > 0 ? ArrowUpRight : ArrowDownRight;
}

/** Rates render as percentages; anything outside 0–1 renders as a plain number. */
function formatMetric(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value >= 0 && value <= 1 ? formatPct(value) : formatNumber(value);
}

export default function AblationTable({ report }: AblationTableProps) {
  const on = report.arms.find((arm) => arm.arm === 'verifier_on');
  const off = report.arms.find((arm) => arm.arm === 'verifier_off');

  if (!on || !off) {
    return (
      <EmptyState
        tone="error"
        title="This run is missing an arm"
        description="An ablation needs both a verifier-ON and a verifier-OFF arm to compare. Re-run it to produce a complete report."
      />
    );
  }

  const keys = orderMetrics([
    ...Object.keys(on.metrics),
    ...Object.keys(off.metrics),
    ...Object.keys(report.delta),
  ]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <caption className="sr-only">
          Verifier ON versus verifier OFF for run {report.run_label}
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
            >
              Metric
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em]"
              style={{ color: ARM_META.verifier_on.color }}
            >
              {ARM_META.verifier_on.label}
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em]"
              style={{ color: ARM_META.verifier_off.color }}
            >
              {ARM_META.verifier_off.label}
            </th>
            <th
              scope="col"
              className="border-l border-border bg-[rgb(var(--accent-rgb)/0.07)] px-3 py-2 text-right text-[10px] font-medium uppercase tracking-[0.14em] text-accent"
              title="Verifier ON minus verifier OFF, read in the direction that counts as better"
            >
              Δ ON − OFF
            </th>
          </tr>
        </thead>

        <tbody>
          {keys.map((key) => {
            const meta = metricMeta(key);
            const onValue = on.metrics[key];
            const offValue = off.metrics[key];
            const reported = report.delta[key];
            const delta =
              typeof reported === 'number' && Number.isFinite(reported)
                ? reported
                : typeof onValue === 'number' && typeof offValue === 'number'
                  ? onValue - offValue
                  : undefined;
            const direction = delta === undefined ? 'flat' : improvement(key, delta);
            const Icon = deltaIcon(delta);

            return (
              <tr key={key} className="border-b border-border last:border-0">
                <th scope="row" className="max-w-[16rem] px-3 py-2.5 font-normal">
                  <span className="block text-xs font-medium text-text">{meta.label}</span>
                  <span className="block text-[11px] leading-snug text-muted">
                    {meta.description}
                  </span>
                </th>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-text">
                  {formatMetric(onValue)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-text">
                  {formatMetric(offValue)}
                </td>
                <td
                  className={cn(
                    'border-l border-border bg-[rgb(var(--accent-rgb)/0.07)] px-3 py-2.5 text-right font-mono text-xs font-semibold tabular-nums',
                    DELTA_TONE[direction],
                  )}
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                    {delta === undefined
                      ? '—'
                      : `${delta > 0 ? '+' : ''}${
                          Math.abs(delta) <= 1 ? formatPct(delta) : formatNumber(delta)
                        }`}
                  </span>
                  <span className="sr-only">
                    {direction === 'better' ? 'better' : direction === 'worse' ? 'worse' : 'unchanged'}
                  </span>
                </td>
              </tr>
            );
          })}

          <tr className="border-t border-border">
            <th scope="row" className="px-3 py-2.5 text-left font-normal">
              <span className="block text-xs font-medium text-text">Samples</span>
              <span className="block text-[11px] text-muted">Claims scored in each arm</span>
            </th>
            <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-text">
              {formatNumber(on.n_samples)}
            </td>
            <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-text">
              {formatNumber(off.n_samples)}
            </td>
            <td className="border-l border-border bg-[rgb(var(--accent-rgb)/0.07)] px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
              {on.n_samples === off.n_samples ? 'paired' : 'unpaired'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

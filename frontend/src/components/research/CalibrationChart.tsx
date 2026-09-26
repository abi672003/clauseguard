/**
 * The threshold sweep. Every point is one candidate entailment threshold; the
 * marked line is the one actually in force, so the trade-off the product made
 * — recall given up to drive the false-obligation rate down — is visible
 * rather than asserted.
 */
import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import EmptyState from '@/components/ui/EmptyState';
import { metricMeta } from '@/components/research/metrics';
import { formatPct } from '@/lib/format';
import type { CalibrationPoint, CalibrationReport } from '@/lib/types';

/** Fixed hue order — colour follows the metric, never its rank in the legend. */
const SERIES = [
  { key: 'f1', color: 'var(--accent)' },
  { key: 'precision', color: 'var(--grounded)' },
  { key: 'recall', color: 'var(--uncertain)' },
  { key: 'false_obligation_rate', color: 'var(--ungrounded)' },
] as const;

function seriesColor(key: string): string {
  return SERIES.find((series) => series.key === key)?.color ?? 'var(--muted)';
}

function CurveTooltip(props: {
  active?: boolean;
  label?: string | number;
  payload?: { dataKey?: string | number; value?: number | string }[];
}) {
  const { active, label, payload } = props;
  if (!active || !payload || payload.length === 0) return null;
  const threshold = typeof label === 'number' ? label : Number(label);
  return (
    <div className="glass min-w-[200px] p-2.5">
      <p className="mb-1.5 font-mono text-xs tabular-nums text-text">
        threshold {Number.isFinite(threshold) ? threshold.toFixed(2) : '—'}
      </p>
      <ul className="space-y-1">
        {payload.map((entry) => {
          const key = String(entry.dataKey);
          return (
            <li key={key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: seriesColor(key) }}
                />
                {metricMeta(key).label}
              </span>
              <span className="font-mono text-xs tabular-nums text-text">
                {formatPct(typeof entry.value === 'number' ? entry.value : null)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The curve point sitting closest to the threshold in force. */
function nearestPoint(curve: CalibrationPoint[], threshold: number): CalibrationPoint | null {
  if (curve.length === 0) return null;
  return curve.reduce((best, point) =>
    Math.abs(point.threshold - threshold) < Math.abs(best.threshold - threshold) ? point : best,
  );
}

export interface CalibrationChartProps {
  report: CalibrationReport;
}

export default function CalibrationChart({ report }: CalibrationChartProps) {
  const reducedMotion = useReducedMotion();

  const curve = useMemo(
    () => [...report.curve].sort((a, b) => a.threshold - b.threshold),
    [report.curve],
  );
  const operating = nearestPoint(curve, report.threshold);

  if (curve.length === 0) {
    return (
      <EmptyState
        title="No threshold sweep recorded"
        description="The backend returned an empty calibration curve. Run an ablation to populate it — the sweep is computed from the same labelled sample."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[320px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="threshold"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tick={{ fill: 'var(--muted)', fontSize: 10 }}
              tickFormatter={(value: number) => value.toFixed(2)}
              label={{
                value: 'Entailment threshold',
                position: 'insideBottom',
                offset: -4,
                fill: 'var(--muted)',
                fontSize: 10,
              }}
              height={44}
            />
            <YAxis
              domain={[0, 1]}
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted)', fontSize: 10 }}
              tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
            />
            <Tooltip
              content={<CurveTooltip />}
              cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
            />
            <Legend
              verticalAlign="top"
              align="left"
              height={28}
              formatter={(value: string) => (
                <span className="text-[11px] text-muted">{value}</span>
              )}
            />

            <ReferenceLine
              x={report.threshold}
              stroke="var(--text)"
              strokeDasharray="4 3"
              label={{
                value: `in force ${report.threshold.toFixed(2)}`,
                position: 'insideTopRight',
                fill: 'var(--text)',
                fontSize: 10,
              }}
            />

            {SERIES.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={metricMeta(series.key).label}
                stroke={series.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                isAnimationActive={!reducedMotion}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {operating && (
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-4">
          {SERIES.map((series) => (
            <div key={series.key} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                <span className="truncate">{metricMeta(series.key).label}</span>
              </dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-text">
                {formatPct(operating[series.key])}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="text-[11px] leading-relaxed text-muted">
        Read at the marked line: those are the numbers the product is actually operating on. Moving
        the threshold right buys a lower false-obligation rate and pays for it in recall — the
        obligations quietly dropped because the clause did not clearly support them.
      </p>
    </div>
  );
}

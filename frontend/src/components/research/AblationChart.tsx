/**
 * Verifier ON vs verifier OFF, one grouped bar per metric.
 *
 * Two series, two hues, direct value labels on every bar — identity is never
 * carried by colour alone. Only 0–1 rate metrics are plotted; anything on
 * another scale would need its own axis, and this chart has exactly one.
 */
import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import EmptyState from '@/components/ui/EmptyState';
import { ARM_META, metricMeta, orderMetrics } from '@/components/research/metrics';
import { formatPct } from '@/lib/format';
import type { AblationReport } from '@/lib/types';

interface Row {
  key: string;
  label: string;
  verifier_on: number;
  verifier_off: number;
}

function isRate(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Axis tick that wraps onto two lines so 400px-wide charts stay legible. */
function MetricTick(props: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const { x = 0, y = 0, payload } = props;
  const words = String(payload?.value ?? '').split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 12 && current) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);

  return (
    <g transform={`translate(${x},${y + 10})`}>
      {lines.slice(0, 3).map((line, index) => (
        <text
          key={line}
          x={0}
          y={index * 11}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize={10}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function ChartTooltip(props: {
  active?: boolean;
  label?: string | number;
  payload?: { dataKey?: string | number; value?: number | string }[];
}) {
  const { active, label, payload } = props;
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="glass min-w-[180px] p-2.5">
      <p className="mb-1.5 text-xs font-medium text-text">{label}</p>
      <ul className="space-y-1">
        {payload.map((entry) => {
          const arm = entry.dataKey === 'verifier_on' ? ARM_META.verifier_on : ARM_META.verifier_off;
          return (
            <li key={String(entry.dataKey)} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: arm.color }}
                />
                {arm.label}
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

export interface AblationChartProps {
  report: AblationReport;
}

export default function AblationChart({ report }: AblationChartProps) {
  const reducedMotion = useReducedMotion();

  const rows = useMemo<Row[]>(() => {
    const on = report.arms.find((arm) => arm.arm === 'verifier_on');
    const off = report.arms.find((arm) => arm.arm === 'verifier_off');
    if (!on || !off) return [];
    const keys = orderMetrics([...Object.keys(on.metrics), ...Object.keys(off.metrics)]);
    return keys
      .filter((key) => isRate(on.metrics[key]) && isRate(off.metrics[key]))
      .map((key) => ({
        key,
        label: metricMeta(key).short,
        verifier_on: on.metrics[key],
        verifier_off: off.metrics[key],
      }));
  }, [report]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No comparable metrics in this run"
        description="The run reported no 0–1 rate metric present in both arms, so there is nothing to plot. The table below still lists everything the backend returned."
      />
    );
  }

  return (
    <div className="h-[340px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 16, right: 8, bottom: 8, left: 0 }} barGap={2}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tick={<MetricTick />}
            height={52}
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
            content={<ChartTooltip />}
            cursor={{ fill: 'rgb(var(--surface-rgb) / 0.06)' }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            formatter={(value: string) => (
              <span className="text-[11px] text-muted">{value}</span>
            )}
          />
          <Bar
            dataKey="verifier_on"
            name={ARM_META.verifier_on.label}
            fill={ARM_META.verifier_on.color}
            radius={[4, 4, 0, 0]}
            isAnimationActive={!reducedMotion}
            maxBarSize={44}
          >
            <LabelList
              dataKey="verifier_on"
              position="top"
              fill="var(--text)"
              fontSize={10}
              formatter={(value: number) => formatPct(value, 0)}
            />
          </Bar>
          <Bar
            dataKey="verifier_off"
            name={ARM_META.verifier_off.label}
            fill={ARM_META.verifier_off.color}
            radius={[4, 4, 0, 0]}
            isAnimationActive={!reducedMotion}
            maxBarSize={44}
          >
            <LabelList
              dataKey="verifier_off"
              position="top"
              fill="var(--text)"
              fontSize={10}
              formatter={(value: number) => formatPct(value, 0)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

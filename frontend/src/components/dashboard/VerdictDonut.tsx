import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ShieldQuestion } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { ChartLegend, ChartTooltip, VERDICT_SERIES } from '@/components/dashboard/chart-kit';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import { formatNumber, formatPct } from '@/lib/format';
import type { DashboardStats } from '@/lib/types';

export interface VerdictDonutProps {
  stats: DashboardStats;
}

/**
 * Part-to-whole of the verification verdicts — three slices, status colours,
 * grounded share called out in the hole. The counts sit in the legend, so the
 * tooltip enhances rather than gates.
 */
export default function VerdictDonut({ stats }: VerdictDonutProps) {
  const reduceMotion = useReducedMotion();

  const data = useMemo(
    () =>
      VERDICT_SERIES.map((series) => ({
        key: series.key,
        name: series.label,
        color: series.color,
        value: stats[series.verdict],
      })),
    [stats],
  );

  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <Card
      title="Verdict split"
      subtitle="Entailment outcome for every verified claim"
      className="min-h-0"
    >
      {total === 0 ? (
        <EmptyState
          icon={ShieldQuestion}
          title="Nothing has been verified yet"
          description="Verdicts appear once a contract has run through the pipeline with the verifier enabled."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={!reduceMotion}
                >
                  {data.map((slice) => (
                    <Cell key={slice.key} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  cursor={false}
                  content={
                    <ChartTooltip
                      formatValue={(value) =>
                        `${formatNumber(value)} · ${formatPct(value / total, 0)}`
                      }
                    />
                  }
                />
              </PieChart>
            </ResponsiveContainer>

            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5"
            >
              <span className="font-mono text-2xl font-semibold leading-none text-grounded">
                {formatPct(stats.grounded / total, 0)}
              </span>
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted">grounded</span>
            </div>
          </div>

          <ChartLegend
            items={data.map((slice) => ({
              key: slice.key,
              label: slice.name,
              color: slice.color,
              value: `${formatNumber(slice.value)} · ${formatPct(slice.value / total, 0)}`,
            }))}
          />

          <p className="text-[11px] leading-relaxed text-muted">
            <span className="font-mono tabular-nums text-text">{formatNumber(total)}</span> claims
            carry an entailment record.{' '}
            {stats.obligations > total && (
              <>
                <span className="font-mono tabular-nums text-text">
                  {formatNumber(stats.obligations - total)}
                </span>{' '}
                were extracted without one.
              </>
            )}
          </p>
        </div>
      )}
    </Card>
  );
}

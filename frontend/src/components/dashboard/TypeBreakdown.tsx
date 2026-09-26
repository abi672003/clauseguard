import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Tags } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  AXIS_LINE,
  AXIS_TICK,
  ChartTooltip,
  GRID_STROKE,
  MAX_BAR_SIZE,
} from '@/components/dashboard/chart-kit';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import { formatNumber, humanize } from '@/lib/format';
import type { DashboardStats } from '@/lib/types';

export interface TypeBreakdownProps {
  stats: DashboardStats;
}

/** Past eight rows the tail folds into one bucket rather than sprouting colours. */
const MAX_ROWS = 8;

interface Row {
  type: string;
  label: string;
  count: number;
}

/** "ip" is an initialism, not a word — everything longer goes through humanize(). */
function typeLabel(type: string): string {
  return type.length <= 2 ? type.toUpperCase() : humanize(type);
}

function toRows(byType: Record<string, number>): Row[] {
  const sorted = Object.entries(byType)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length <= MAX_ROWS) {
    return sorted.map(([type, count]) => ({ type, label: typeLabel(type), count }));
  }

  const head = sorted.slice(0, MAX_ROWS - 1);
  const tail = sorted.slice(MAX_ROWS - 1);
  return [
    ...head.map(([type, count]) => ({ type, label: typeLabel(type), count })),
    {
      type: '__other__',
      label: `Other (${tail.length})`,
      count: tail.reduce((sum, [, count]) => sum + count, 0),
    },
  ];
}

/**
 * Obligations by type. One series, therefore one colour for every bar — a
 * darker-where-bigger ramp would only re-encode the bar length.
 */
export default function TypeBreakdown({ stats }: TypeBreakdownProps) {
  const reduceMotion = useReducedMotion();
  const rows = useMemo(() => toRows(stats.by_type), [stats.by_type]);

  return (
    <Card title="Obligations by type" subtitle="What the register is actually made of">
      {rows.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No obligations extracted yet"
          description="Analyse a contract and its obligations will be broken down here by type."
        />
      ) : (
        <div className="w-full" style={{ height: Math.max(176, rows.length * 34 + 36) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
              barCategoryGap="28%"
            >
              <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={92}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgb(var(--surface-rgb) / 0.06)' }}
                content={<ChartTooltip formatValue={(value) => formatNumber(value)} />}
              />
              <Bar
                dataKey="count"
                name="Obligations"
                fill="var(--accent)"
                radius={[0, 4, 4, 0]}
                maxBarSize={MAX_BAR_SIZE}
                isAnimationActive={!reduceMotion}
              >
                {/* The value rides the bar tip, so the tooltip enhances rather than gates. */}
                <LabelList
                  dataKey="count"
                  position="right"
                  offset={8}
                  fill="var(--muted)"
                  fontSize={11}
                  formatter={(value: number) => formatNumber(value)}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

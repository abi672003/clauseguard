import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { CalendarRange } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  AXIS_LINE,
  AXIS_TICK,
  ChartLegend,
  ChartTooltip,
  GRID_STROKE,
  VERDICT_SERIES,
  type SeriesSpec,
} from '@/components/dashboard/chart-kit';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import { formatDate, formatNumber, humanize } from '@/lib/format';
import type { DashboardStats, MonthBucket } from '@/lib/types';

export interface MonthlyTrendProps {
  stats: DashboardStats;
}

/**
 * `by_month` is `dict[str, Any]` on the wire, so the series are discovered from
 * the response rather than assumed. Today the API buckets obligations by the
 * month they fall due and splits them by status; if it ever publishes the
 * verdict triple instead, that takes precedence without a change here.
 */
const STATUS_SERIES: SeriesSpec[] = [
  { key: 'auto_tracked', label: 'Auto-tracked', color: 'var(--grounded)' },
  { key: 'approved', label: 'Approved', color: 'var(--accent)' },
  { key: 'pending_review', label: 'Pending review', color: 'var(--uncertain)' },
  { key: 'rejected', label: 'Rejected', color: 'var(--ungrounded)' },
];

const TOTAL_KEYS = ['total', 'obligations', 'count', 'contracts'];

function numericKeys(rows: MonthBucket[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key === 'month') continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function resolveSeries(rows: MonthBucket[]): SeriesSpec[] {
  const present = numericKeys(rows);
  if (present.length === 0) return [];

  // The verdict triple is the story when it is there: stacked, it shows the
  // verifier's judgement over time rather than raw volume.
  const verdicts = VERDICT_SERIES.filter((series) => present.includes(series.key)).map(
    ({ key, label, color }) => ({ key, label, color }),
  );
  if (verdicts.length > 0) return verdicts;

  const statuses = STATUS_SERIES.filter((series) => present.includes(series.key));
  if (statuses.length > 0) return statuses;

  // Last resort: one series, not several in the same colour — identity would
  // be lost the moment a second accent-coloured band appeared.
  const single = TOTAL_KEYS.find((key) => present.includes(key)) ?? present[0];
  return [{ key: single, label: humanize(single), color: 'var(--accent)' }];
}

/** "2025-03" -> "Mar 25"; anything else is passed through untouched. */
function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return month;
  return formatDate(`${match[1]}-${match[2]}-01`, { month: 'short', year: '2-digit' });
}

interface TrendRow {
  month: string;
  label: string;
  [key: string]: string | number;
}

export default function MonthlyTrend({ stats }: MonthlyTrendProps) {
  const reduceMotion = useReducedMotion();

  const series = useMemo(() => resolveSeries(stats.by_month), [stats.by_month]);
  const stacked = series.length > 1;

  const rows = useMemo<TrendRow[]>(
    () =>
      stats.by_month.map((bucket) => {
        const month = typeof bucket.month === 'string' ? bucket.month : String(bucket.month ?? '');
        const row: TrendRow = { month, label: monthLabel(month) };
        for (const spec of series) {
          const value = bucket[spec.key];
          row[spec.key] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
        }
        return row;
      }),
    [stats.by_month, series],
  );

  const totals = useMemo(() => {
    const sums = new Map<string, number>();
    for (const row of rows) {
      for (const spec of series) {
        const value = row[spec.key];
        sums.set(spec.key, (sums.get(spec.key) ?? 0) + (typeof value === 'number' ? value : 0));
      }
    }
    return sums;
  }, [rows, series]);

  const hasData = rows.length > 0 && series.length > 0;

  return (
    <Card
      title="Due-date timeline"
      subtitle={
        stacked
          ? 'Obligations by the month they fall due, split by tracking status'
          : 'Obligations by the month they fall due'
      }
    >
      {!hasData ? (
        <EmptyState
          icon={CalendarRange}
          title="No dated obligations yet"
          description="Only obligations the extractor could pin to a date appear here. Analyse a contract with deadline clauses and its timeline builds up."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  axisLine={AXIS_LINE}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  width={36}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--border)' }}
                  content={<ChartTooltip formatValue={(value) => formatNumber(value)} />}
                />
                {series.map((spec) => (
                  <Area
                    key={spec.key}
                    type="monotone"
                    dataKey={spec.key}
                    name={spec.label}
                    stackId={stacked ? 'verdict' : undefined}
                    stroke={spec.color}
                    strokeWidth={2}
                    fill={spec.color}
                    fillOpacity={0.1}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-elev)' }}
                    isAnimationActive={!reduceMotion}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {stacked && (
            <ChartLegend
              items={series.map((spec) => ({
                key: spec.key,
                label: spec.label,
                color: spec.color,
                value: formatNumber(totals.get(spec.key) ?? 0),
              }))}
            />
          )}
        </div>
      )}
    </Card>
  );
}

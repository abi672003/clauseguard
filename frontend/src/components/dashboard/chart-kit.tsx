import type { Verdict } from '@/lib/types';

/**
 * Shared recharts chrome. Every colour is a design token; the axes and grid are
 * solid hairlines one step off the surface, and text never wears a series colour.
 */

export const GRID_STROKE = 'var(--border)';
export const AXIS_TICK = { fill: 'var(--muted)', fontSize: 11 } as const;
export const AXIS_LINE = { stroke: 'var(--border)' } as const;

/** Bars stay thin; the leftover band is air. */
export const MAX_BAR_SIZE = 24;

export interface SeriesSpec {
  key: string;
  label: string;
  /** A `var(--token)` reference — never a literal colour. */
  color: string;
}

/** Verdict is a status scale, not a categorical one: the colours mean something. */
export const VERDICT_SERIES: readonly (SeriesSpec & { verdict: Verdict })[] = [
  { key: 'grounded', label: 'Grounded', color: 'var(--grounded)', verdict: 'grounded' },
  { key: 'uncertain', label: 'Uncertain', color: 'var(--uncertain)', verdict: 'uncertain' },
  { key: 'ungrounded', label: 'Ungrounded', color: 'var(--ungrounded)', verdict: 'ungrounded' },
] as const;

/* --------------------------------------------------------------- tooltip */
interface TooltipEntry {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  dataKey?: string | number;
}

export interface ChartTooltipProps {
  /** Injected by recharts. */
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  /** Ours — recharts has no props by these names, so the clone cannot clobber them. */
  formatLabel?: (label: string | number) => string;
  formatValue?: (value: number) => string;
}

function toNumber(value: TooltipEntry['value']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Tooltips enhance; every value here is also reachable from the panel's own list. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatValue,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const heading =
    label === undefined || label === null
      ? null
      : formatLabel
        ? formatLabel(label)
        : String(label);

  return (
    <div className="glass max-w-[220px] px-3 py-2">
      {heading && (
        <p className="pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          {heading}
        </p>
      )}
      <dl className="flex flex-col gap-1">
        {payload.map((entry, index) => {
          const numeric = toNumber(entry.value);
          return (
            <div
              key={`${String(entry.dataKey ?? entry.name ?? index)}`}
              className="flex items-center gap-2"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color ?? 'var(--muted)' }}
              />
              <dt className="min-w-0 flex-1 truncate text-xs text-muted">
                {String(entry.name ?? entry.dataKey ?? '')}
              </dt>
              <dd className="font-mono text-xs tabular-nums text-text">
                {numeric === null
                  ? '—'
                  : formatValue
                    ? formatValue(numeric)
                    : numeric.toLocaleString('en-US')}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------------- legend */
export interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  value?: string;
}

/** Always present for two or more series — identity is never colour-alone. */
export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <dt className="truncate text-[11px] text-muted">{item.label}</dt>
          {item.value !== undefined && (
            <dd className="font-mono text-[11px] tabular-nums text-text">{item.value}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

import { cn, formatPct } from '@/lib/format';

export interface ProbabilityBarProps {
  /** Three-way NLI distribution, each 0–1. */
  entailment: number;
  neutral: number;
  contradiction: number;
  /** Entailment threshold (0–1) the verdict was decided against. */
  threshold?: number | null;
  showLegend?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const HEIGHT = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' } as const;

const SEGMENTS = [
  { key: 'entailment', label: 'Entail', color: 'var(--grounded)', text: 'text-grounded' },
  { key: 'neutral', label: 'Neutral', color: 'var(--muted)', text: 'text-muted' },
  {
    key: 'contradiction',
    label: 'Contradict',
    color: 'var(--ungrounded)',
    text: 'text-ungrounded',
  },
] as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The entailment evidence, made legible: one stacked bar of
 * entail / neutral / contradiction with the decision threshold marked.
 */
export default function ProbabilityBar({
  entailment,
  neutral,
  contradiction,
  threshold,
  showLegend = true,
  size = 'md',
  className,
}: ProbabilityBarProps) {
  const raw = {
    entailment: clamp01(entailment),
    neutral: clamp01(neutral),
    contradiction: clamp01(contradiction),
  };
  const total = raw.entailment + raw.neutral + raw.contradiction;
  const scale = total > 0 ? 1 / total : 0;

  const hasThreshold =
    threshold !== null && threshold !== undefined && Number.isFinite(threshold);
  const markerPct = hasThreshold ? clamp01(threshold) * 100 : 0;

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div
        role="img"
        aria-label={`Entailment ${formatPct(raw.entailment)}, neutral ${formatPct(
          raw.neutral,
        )}, contradiction ${formatPct(raw.contradiction)}${
          hasThreshold ? `, threshold ${formatPct(threshold)}` : ''
        }`}
        className={cn(
          'relative flex w-full overflow-hidden rounded-full border border-border bg-surface',
          HEIGHT[size],
        )}
      >
        {SEGMENTS.map((segment) => (
          <div
            key={segment.key}
            className="h-full transition-[width] duration-320 ease-instrument"
            style={{
              width: `${raw[segment.key] * scale * 100}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}

        {hasThreshold && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-text mix-blend-screen"
            style={{ left: `${markerPct}%` }}
          />
        )}
      </div>

      {showLegend && (
        <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {SEGMENTS.map((segment) => (
            <div key={segment.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <dt className="text-[11px] uppercase tracking-wide text-muted">{segment.label}</dt>
              <dd className={cn('font-mono text-xs tabular-nums', segment.text)}>
                {formatPct(raw[segment.key])}
              </dd>
            </div>
          ))}

          {hasThreshold && (
            <div className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-0.5 shrink-0 bg-text" />
              <dt className="text-[11px] uppercase tracking-wide text-muted">Threshold</dt>
              <dd className="font-mono text-xs tabular-nums text-text">{formatPct(threshold)}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

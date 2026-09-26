/**
 * The three states every panel in this product owes the user: loading,
 * empty, and a *readable* error. Shared by the obligation, review and
 * research screens so a failure never renders as a blank region.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/format';

/** Turns anything thrown by the API client into one sentence a human can act on. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return `${error.message}. Is the backend running on port 8000?`;
    }
    if (error.status === 404) return `${error.message} (not found)`;
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'An unexpected error occurred.';
}

export interface ErrorPanelProps {
  error: unknown;
  /** What failed, in the user's language: "the obligation register". */
  what: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorPanel({ error, what, onRetry, className }: ErrorPanelProps) {
  return (
    <EmptyState
      tone="error"
      icon={AlertTriangle}
      className={className}
      title={`Could not load ${what}`}
      description={describeError(error)}
      action={
        onRetry && (
          <Button
            variant="primary"
            onClick={onRetry}
            iconLeft={<RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
          >
            Retry
          </Button>
        )
      }
    />
  );
}

export interface SkeletonRowsProps {
  rows?: number;
  /** Tailwind height class for each row. */
  height?: string;
  className?: string;
  label?: string;
}

/** Stacked placeholder rows — the house loading state for lists and tables. */
export function SkeletonRows({
  rows = 6,
  height = 'h-12',
  className,
  label = 'Loading',
}: SkeletonRowsProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn('flex flex-col gap-2', className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={height} rounded="lg" />
      ))}
    </div>
  );
}

/** A labelled value in the dense "facts" grids. Numbers stay monospace. */
export function Fact({
  label,
  children,
  mono = false,
  className,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className={cn('break-words text-xs text-text', mono && 'font-mono tabular-nums')}>
        {children}
      </dd>
    </div>
  );
}

export interface MeterProps {
  /** 0–1. */
  value: number;
  /** CSS custom property reference for the fill. */
  color?: string;
  label?: string;
  className?: string;
}

/** A single 0–1 score as a thin bar. Used for confidences, never for verdicts. */
export function Meter({ value, color = 'var(--accent)', label, className }: MeterProps) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value * 100 : 0));
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface', className)}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Score'}
    >
      <div
        className="h-full rounded-full transition-[width] duration-320 ease-instrument"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

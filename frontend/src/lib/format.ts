/** Formatting + presentation helpers shared by every screen. */
import clsx, { type ClassValue } from 'clsx';

import type { Severity, Verdict } from '@/lib/types';

/** Placeholder for a value the API did not supply. */
export const EMPTY = '—';

/* ----------------------------------------------------------------- dates */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  // Bare ISO dates (YYYY-MM-DD) parse as UTC midnight; pin them to local noon
  // so a timezone west of UTC does not render them a day early.
  const raw =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00`
      : value;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: '2-digit' },
): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat('en-GB', options).format(date);
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  return formatDate(value, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Whole days from today until `value`. Negative when overdue, null when absent. */
export function daysUntil(value: string | number | Date | null | undefined): number | null {
  const date = toDate(value);
  if (!date) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const MS_PER_DAY = 86_400_000;
  return Math.round((startOfDay(date) - startOfDay(new Date())) / MS_PER_DAY);
}

/** "in 12 days" / "3 days ago" / "today". Falls back to absolute for far dates. */
export function formatRelativeDate(value: string | number | Date | null | undefined): string {
  const days = daysUntil(value);
  if (days === null) return EMPTY;
  if (days === 0) return 'today';
  if (Math.abs(days) > 365) return formatDate(value);

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(days) >= 60) return rtf.format(Math.round(days / 30), 'month');
  if (Math.abs(days) >= 14) return rtf.format(Math.round(days / 7), 'week');
  return rtf.format(days, 'day');
}

/* --------------------------------------------------------------- numbers */
export function formatCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined = 'USD',
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return EMPTY;
  const code = (currency ?? 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    // Unknown / non-ISO currency code — render the number and the code verbatim.
    return `${new Intl.NumberFormat('en-US').format(amount)} ${code}`;
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  return new Intl.NumberFormat('en-US').format(value);
}

/** Takes a 0–1 probability and renders it as a percentage. */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

/* --------------------------------------------------------------- strings */
export function truncate(value: string, n: number): string {
  if (n <= 0) return '';
  if (value.length <= n) return value;
  return `${value.slice(0, Math.max(0, n - 1)).trimEnd()}…`;
}

/** "auto_tracked" -> "Auto tracked" */
export function humanize(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ---------------------------------------------------------------- tokens */
/** Maps a verdict to its CSS design token. Never hardcode these colours. */
export function verdictColorVar(verdict: Verdict): string {
  switch (verdict) {
    case 'grounded':
      return 'var(--grounded)';
    case 'ungrounded':
      return 'var(--ungrounded)';
    case 'uncertain':
      return 'var(--uncertain)';
  }
}

/** Channel-triplet twin of `verdictColorVar`, for alpha compositing. */
export function verdictRgbVar(verdict: Verdict): string {
  switch (verdict) {
    case 'grounded':
      return 'var(--grounded-rgb)';
    case 'ungrounded':
      return 'var(--ungrounded-rgb)';
    case 'uncertain':
      return 'var(--uncertain-rgb)';
  }
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** low=0 … critical=3. Used for sorting and as the z-axis of the constellation. */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity] ?? 0;
}

/* -------------------------------------------------------------- classnames */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

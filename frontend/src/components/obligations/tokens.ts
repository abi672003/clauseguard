/**
 * Shared vocabulary for the obligation / review / research surfaces: the enum
 * lists the API returns, their token-backed presentation meta, and the guards
 * that turn untrusted URL search params back into typed filter values.
 *
 * Every colour here is a `var(--token)` reference — never a literal.
 */
import type { BadgeTone } from '@/components/ui/Badge';
import { daysUntil } from '@/lib/format';
import type {
  AgentAction,
  ObligationStatus,
  ObligationType,
  PolicyMode,
  ReviewState,
  Severity,
  Verdict,
} from '@/lib/types';

/* ------------------------------------------------------------ enum lists */
export const SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const satisfies readonly Severity[];

export const OBLIGATION_STATUSES = [
  'auto_tracked',
  'pending_review',
  'approved',
  'rejected',
  'expired',
] as const satisfies readonly ObligationStatus[];

export const OBLIGATION_TYPES = [
  'deadline',
  'renewal',
  'termination',
  'payment',
  'reporting',
  'restriction',
  'liability',
  'ip',
  'audit',
  'insurance',
  'other',
] as const satisfies readonly ObligationType[];

export const VERDICTS = [
  'grounded',
  'uncertain',
  'ungrounded',
] as const satisfies readonly Verdict[];

export const REVIEW_STATES = [
  'open',
  'approved',
  'rejected',
] as const satisfies readonly ReviewState[];

/* ----------------------------------------------------------------- meta */
export interface TokenMeta {
  label: string;
  tone: BadgeTone;
  /** CSS custom property reference, e.g. `var(--grounded)`. */
  color: string;
  /** Channel-triplet twin, for alpha compositing. */
  rgb: string;
}

const MUTED: Pick<TokenMeta, 'color' | 'rgb'> = {
  color: 'var(--muted)',
  rgb: 'var(--muted-rgb)',
};
const ACCENT: Pick<TokenMeta, 'color' | 'rgb'> = {
  color: 'var(--accent)',
  rgb: 'var(--accent-rgb)',
};
const GROUNDED: Pick<TokenMeta, 'color' | 'rgb'> = {
  color: 'var(--grounded)',
  rgb: 'var(--grounded-rgb)',
};
const UNCERTAIN: Pick<TokenMeta, 'color' | 'rgb'> = {
  color: 'var(--uncertain)',
  rgb: 'var(--uncertain-rgb)',
};
const UNGROUNDED: Pick<TokenMeta, 'color' | 'rgb'> = {
  color: 'var(--ungrounded)',
  rgb: 'var(--ungrounded-rgb)',
};

/** Severity ramps muted -> accent -> amber -> red. */
export const SEVERITY_META: Record<Severity, TokenMeta> = {
  low: { label: 'Low', tone: 'muted', ...MUTED },
  medium: { label: 'Medium', tone: 'accent', ...ACCENT },
  high: { label: 'High', tone: 'uncertain', ...UNCERTAIN },
  critical: { label: 'Critical', tone: 'ungrounded', ...UNGROUNDED },
};

export const STATUS_META: Record<ObligationStatus, TokenMeta> = {
  auto_tracked: { label: 'Auto-tracked', tone: 'accent', ...ACCENT },
  pending_review: { label: 'Pending review', tone: 'uncertain', ...UNCERTAIN },
  approved: { label: 'Approved', tone: 'grounded', ...GROUNDED },
  rejected: { label: 'Rejected', tone: 'ungrounded', ...UNGROUNDED },
  expired: { label: 'Expired', tone: 'muted', ...MUTED },
};

export const VERDICT_META: Record<Verdict, TokenMeta> = {
  grounded: { label: 'Grounded', tone: 'grounded', ...GROUNDED },
  uncertain: { label: 'Uncertain', tone: 'uncertain', ...UNCERTAIN },
  ungrounded: { label: 'Ungrounded', tone: 'ungrounded', ...UNGROUNDED },
};

export const ACTION_META: Record<AgentAction, TokenMeta> = {
  auto_track: { label: 'Auto-track', tone: 'grounded', ...GROUNDED },
  escalate: { label: 'Escalate to human', tone: 'uncertain', ...UNCERTAIN },
  reject: { label: 'Reject', tone: 'ungrounded', ...UNGROUNDED },
};

export const REVIEW_STATE_META: Record<ReviewState, TokenMeta> = {
  open: { label: 'Open', tone: 'uncertain', ...UNCERTAIN },
  approved: { label: 'Approved', tone: 'grounded', ...GROUNDED },
  rejected: { label: 'Rejected', tone: 'ungrounded', ...UNGROUNDED },
};

export const POLICY_MODE_META: Record<PolicyMode, { label: string; hint: string }> = {
  llm: { label: 'LLM policy', hint: 'A language model wrote this decision.' },
  deterministic: {
    label: 'Deterministic policy',
    hint: 'Decided by the hand-written threshold rules, with no model in the loop.',
  },
};

/** "auto_tracked" -> "Auto-tracked", with a safe fallback for unknown values. */
export function statusLabel(status: ObligationStatus): string {
  return STATUS_META[status]?.label ?? status;
}

export function typeLabel(type: ObligationType | string): string {
  if (type === 'ip') return 'IP';
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
}

/* --------------------------------------------------------------- guards */
/** Narrows an untrusted string (URL param, form value) to a known enum member. */
export function asEnum<T extends string>(
  allowed: readonly T[],
  raw: string | null | undefined,
): T | undefined {
  if (!raw) return undefined;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** True only for a well-formed YYYY-MM-DD date. */
export function asIsoDate(raw: string | null | undefined): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return Number.isNaN(new Date(`${raw}T12:00:00`).getTime()) ? undefined : raw;
}

export function asPositiveInt(
  raw: string | null | undefined,
  fallback: number,
  max = 1_000_000,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/* ----------------------------------------------------------------- dates */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** An obligation is overdue when its due date has passed and it is still live. */
export function isOverdue(
  dueDate: string | null | undefined,
  status: ObligationStatus,
): boolean {
  if (status === 'rejected' || status === 'approved') return false;
  const days = daysUntil(dueDate);
  return days !== null && days < 0;
}

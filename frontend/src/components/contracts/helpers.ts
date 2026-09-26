/**
 * Presentation-only helpers shared by the contract screens.
 * Nothing here fetches or invents data — it only reshapes what the API returned.
 */
import type { BadgeTone } from '@/components/ui/Badge';
import { EMPTY } from '@/lib/format';
import { PIPELINE_STAGES } from '@/lib/types';
import type {
  ClauseOut,
  ContractSummary,
  ObligationDetail,
  Severity,
  Verdict,
} from '@/lib/types';

/* ------------------------------------------------------------------ files */
export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;

/** `accept` attribute for the file input / dropzone. */
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

export function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 || value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

/* ----------------------------------------------------------------- status */
/** Mirrors `ContractStatus` in backend/app/db/models.py. */
export const CONTRACT_STATUSES = ['pending', 'processing', 'complete', 'failed'] as const;

export type ContractStatusName = (typeof CONTRACT_STATUSES)[number];

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'complete':
      return 'grounded';
    case 'processing':
      return 'accent';
    case 'failed':
      return 'ungrounded';
    case 'pending':
      return 'uncertain';
    default:
      return 'muted';
  }
}

/** A contract is "in flight" while the pipeline still has work queued for it. */
export function isInFlight(status: string): boolean {
  return status === 'processing' || status === 'pending';
}

export function anyInFlight(items: readonly ContractSummary[] | undefined): boolean {
  return (items ?? []).some((contract) => isInFlight(contract.status));
}

export function severityTone(severity: Severity): BadgeTone {
  switch (severity) {
    case 'critical':
      return 'ungrounded';
    case 'high':
      return 'uncertain';
    case 'medium':
      return 'accent';
    case 'low':
      return 'muted';
  }
}

/* --------------------------------------------------------------- verdicts */
const VERDICT_RANK: Record<Verdict, number> = { grounded: 0, uncertain: 1, ungrounded: 2 };

/**
 * Clause id -> the *worst* verdict of any obligation drawn from that clause.
 * Worst wins so a risky claim is never hidden behind a grounded sibling.
 */
export function clauseVerdictMap(obligations: readonly ObligationDetail[]): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  for (const obligation of obligations) {
    const verdict = obligation.verification?.verdict;
    if (!verdict) continue;
    const current = map.get(obligation.clause_id);
    if (current === undefined || VERDICT_RANK[verdict] > VERDICT_RANK[current]) {
      map.set(obligation.clause_id, verdict);
    }
  }
  return map;
}

/** Clause id -> the obligations drawn from it, in API order. */
export function obligationsByClause(
  obligations: readonly ObligationDetail[],
): Map<string, ObligationDetail[]> {
  const map = new Map<string, ObligationDetail[]>();
  for (const obligation of obligations) {
    const bucket = map.get(obligation.clause_id);
    if (bucket) bucket.push(obligation);
    else map.set(obligation.clause_id, [obligation]);
  }
  return map;
}

/* ------------------------------------------------------------ clause text */
export interface TextSegment {
  key: string;
  text: string;
  /** Null for the plain prose between clauses. */
  clause: ClauseOut | null;
  verdict: Verdict | null;
  obligationCount: number;
}

export interface TextBlock {
  index: number;
  segments: TextSegment[];
}

export interface ClauseDocument {
  blocks: TextBlock[];
  /** Clause id -> index of the block that renders it. */
  clauseBlock: Map<string, number>;
  /** Clauses that actually landed inside `raw_text` and were rendered. */
  renderedClauses: number;
}

/**
 * Splits `rawText` on the clause offsets so each clause can be marked up.
 * Out-of-range and overlapping spans are clipped rather than dropped, so a
 * slightly noisy segmenter can never corrupt the document.
 */
export function buildSegments(
  rawText: string,
  clauses: readonly ClauseOut[],
  verdicts: Map<string, Verdict>,
  counts: Map<string, ObligationDetail[]>,
): TextSegment[] {
  const ordered = clauses
    .filter(
      (clause) =>
        Number.isFinite(clause.char_start) &&
        Number.isFinite(clause.char_end) &&
        clause.char_start >= 0 &&
        clause.char_start < rawText.length &&
        clause.char_end > clause.char_start,
    )
    .slice()
    .sort((a, b) => a.char_start - b.char_start || a.char_end - b.char_end);

  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const clause of ordered) {
    const start = Math.max(clause.char_start, cursor);
    const end = Math.min(clause.char_end, rawText.length);
    if (end <= start) continue; // fully swallowed by the previous clause

    if (start > cursor) {
      segments.push({
        key: `gap-${cursor}`,
        text: rawText.slice(cursor, start),
        clause: null,
        verdict: null,
        obligationCount: 0,
      });
    }

    segments.push({
      key: `clause-${clause.id}`,
      text: rawText.slice(start, end),
      clause,
      verdict: verdicts.get(clause.id) ?? null,
      obligationCount: counts.get(clause.id)?.length ?? 0,
    });
    cursor = end;
  }

  if (cursor < rawText.length) {
    segments.push({
      key: `gap-${cursor}`,
      text: rawText.slice(cursor),
      clause: null,
      verdict: null,
      obligationCount: 0,
    });
  }

  return segments;
}

/**
 * Buckets segments into fixed-size blocks so a very long contract can be
 * windowed. A clause is never split across two blocks.
 */
export function buildDocument(
  rawText: string,
  clauses: readonly ClauseOut[],
  verdicts: Map<string, Verdict>,
  counts: Map<string, ObligationDetail[]>,
  blockChars: number,
): ClauseDocument {
  const segments = buildSegments(rawText, clauses, verdicts, counts);
  const blocks: TextBlock[] = [];
  const clauseBlock = new Map<string, number>();

  let current: TextSegment[] = [];
  let size = 0;
  let renderedClauses = 0;

  const flush = () => {
    if (current.length === 0) return;
    blocks.push({ index: blocks.length, segments: current });
    current = [];
    size = 0;
  };

  for (const segment of segments) {
    current.push(segment);
    size += segment.text.length;
    if (segment.clause) {
      clauseBlock.set(segment.clause.id, blocks.length);
      renderedClauses += 1;
    }
    if (size >= blockChars) flush();
  }
  flush();

  return { blocks, clauseBlock, renderedClauses };
}

/* ---------------------------------------------------------- stage timings */
export interface StageTimingEntry {
  stage: string;
  ms: number;
  detail: Record<string, unknown> | null;
}

const STAGE_ORDER = new Map<string, number>(
  PIPELINE_STAGES.map((stage, index): [string, number] => [stage, index]),
);

/**
 * `PipelineRunOut.stage_timings` is `dict[str, Any]`: values arrive either as a
 * raw millisecond number or as a `StageTiming` object. Normalise both.
 */
export function stageTimings(raw: Record<string, unknown> | null | undefined): StageTimingEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const entries: StageTimingEntry[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      entries.push({ stage: key, ms: value, detail: null });
      continue;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const ms = typeof record.ms === 'number' && Number.isFinite(record.ms) ? record.ms : null;
      if (ms === null) continue;
      const detail =
        record.detail && typeof record.detail === 'object'
          ? (record.detail as Record<string, unknown>)
          : null;
      entries.push({
        stage: typeof record.stage === 'string' ? record.stage : key,
        ms,
        detail,
      });
    }
  }

  return entries.sort((a, b) => {
    const rankA = STAGE_ORDER.get(a.stage) ?? Number.MAX_SAFE_INTEGER;
    const rankB = STAGE_ORDER.get(b.stage) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.stage.localeCompare(b.stage);
  });
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Counts dicts arrive as `dict[str, Any]`; keep only the numeric entries. */
export function numericCounts(raw: Record<string, unknown> | null | undefined): [string, number][] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
}

/** Escapes a value for use inside an attribute selector. */
export function attrSelector(attribute: string, value: string): string {
  return `[${attribute}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

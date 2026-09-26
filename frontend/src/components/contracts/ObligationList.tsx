import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowUpRight, CalendarClock, ListChecks, ShieldOff } from 'lucide-react';

import Badge, { type BadgeTone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import VerdictChip from '@/components/ui/VerdictChip';
import { attrSelector, severityTone } from '@/components/contracts/helpers';
import {
  cn,
  daysUntil,
  EMPTY,
  formatDate,
  formatPct,
  formatRelativeDate,
  humanize,
} from '@/lib/format';
import type { ObligationDetail, ObligationStatus, Verdict } from '@/lib/types';

const STATUS_TONE: Record<ObligationStatus, BadgeTone> = {
  auto_tracked: 'grounded',
  approved: 'grounded',
  pending_review: 'uncertain',
  rejected: 'ungrounded',
  expired: 'muted',
};

type VerdictFilter = Verdict | 'unverified' | null;

export interface ObligationListProps {
  obligations: readonly ObligationDetail[];
  selectedObligationId: string | null;
  selectedClauseId: string | null;
  onSelect: (obligation: ObligationDetail) => void;
  contractStatus: string;
  className?: string;
}

/**
 * The obligations drawn from this contract. Selecting one drives the clause
 * highlight in the text pane; selecting a clause over there scrolls the matching
 * card into view here.
 */
export default function ObligationList({
  obligations,
  selectedObligationId,
  selectedClauseId,
  onSelect,
  contractStatus,
  className,
}: ObligationListProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<VerdictFilter>(null);

  const counts = useMemo(() => {
    const tally = { grounded: 0, uncertain: 0, ungrounded: 0, unverified: 0 };
    for (const obligation of obligations) {
      const verdict = obligation.verification?.verdict;
      if (verdict) tally[verdict] += 1;
      else tally.unverified += 1;
    }
    return tally;
  }, [obligations]);

  const visible = useMemo(() => {
    if (!filter) return obligations.slice();
    return obligations.filter((obligation) =>
      filter === 'unverified'
        ? !obligation.verification
        : obligation.verification?.verdict === filter,
    );
  }, [filter, obligations]);

  // Keep the selected card in view when the selection comes from the text pane.
  useEffect(() => {
    if (!selectedObligationId) return;
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      attrSelector('data-obligation-id', selectedObligationId),
    );
    if (!target) return;
    const top = target.offsetTop - container.clientHeight / 2 + target.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
    // Deliberately *not* keyed on `visible`: a 3s poll must not yank the
    // reader back to the selected card while they are scrolling.
  }, [filter, reducedMotion, selectedObligationId]);

  const toggleFilter = useCallback((next: Exclude<VerdictFilter, null>) => {
    setFilter((previous) => (previous === next ? null : next));
  }, []);

  const chips: { key: Exclude<VerdictFilter, null>; label: string; tone: BadgeTone; count: number }[] =
    [
      { key: 'grounded', label: 'Grounded', tone: 'grounded', count: counts.grounded },
      { key: 'uncertain', label: 'Uncertain', tone: 'uncertain', count: counts.uncertain },
      { key: 'ungrounded', label: 'Ungrounded', tone: 'ungrounded', count: counts.ungrounded },
      { key: 'unverified', label: 'Unverified', tone: 'muted', count: counts.unverified },
    ];

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            disabled={chip.count === 0}
            aria-pressed={filter === chip.key}
            onClick={() => toggleFilter(chip.key)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-240 ease-instrument',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'disabled:cursor-not-allowed disabled:opacity-40',
              filter === chip.key
                ? 'border-[rgb(var(--accent-rgb)/0.45)] bg-[rgb(var(--accent-rgb)/0.14)] text-accent'
                : 'border-border bg-surface text-muted hover:text-text',
            )}
          >
            {chip.label}{' '}
            <span className="font-mono tabular-nums">{chip.count}</span>
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <EmptyState
            icon={obligations.length === 0 ? ListChecks : ShieldOff}
            title={
              obligations.length === 0
                ? contractStatus === 'processing' || contractStatus === 'pending'
                  ? 'Extraction still running'
                  : 'No obligations drawn from this contract'
                : 'No obligations match that verdict'
            }
            description={
              obligations.length === 0
                ? contractStatus === 'processing' || contractStatus === 'pending'
                  ? 'The pipeline is still segmenting and verifying — obligations appear here as they clear the verifier.'
                  : 'Nothing in this document cleared the prefilter and the extractor. Re-analyse with the verifier toggled if you expect obligations here.'
                : 'Clear the verdict filter to see every obligation from this contract.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((obligation) => {
              const selected = selectedObligationId === obligation.id;
              const clauseLinked =
                !selected && selectedClauseId !== null && selectedClauseId === obligation.clause_id;
              const days = daysUntil(obligation.due_date);
              const overdue = days !== null && days < 0;

              return (
                <li key={obligation.id}>
                  <article
                    data-obligation-id={obligation.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => onSelect(obligation)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(obligation);
                      }
                    }}
                    className={cn(
                      'flex cursor-pointer flex-col gap-2 rounded-xl border p-3 transition-[background-color,border-color,box-shadow] duration-320 ease-instrument',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      selected
                        ? 'border-[rgb(var(--accent-rgb)/0.5)] bg-[rgb(var(--accent-rgb)/0.1)] shadow-glow'
                        : clauseLinked
                          ? 'border-[rgb(var(--accent-rgb)/0.3)] bg-surface'
                          : 'border-border bg-surface hover:border-[rgb(var(--accent-rgb)/0.28)]',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="accent" size="xs">
                        {humanize(obligation.obligation_type)}
                      </Badge>
                      <Badge tone={severityTone(obligation.severity)} size="xs">
                        {humanize(obligation.severity)}
                      </Badge>
                      <Badge tone={STATUS_TONE[obligation.status]} size="xs">
                        {humanize(obligation.status)}
                      </Badge>
                      <Link
                        to={`/obligations/${encodeURIComponent(obligation.id)}`}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Open the verification evidence for ${obligation.title}`}
                        className="ml-auto rounded text-muted transition-colors duration-240 ease-instrument hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                      </Link>
                    </div>

                    <p className="text-sm font-medium leading-snug text-text">{obligation.title}</p>
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted">
                      {obligation.claim}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums',
                          overdue ? 'text-ungrounded' : 'text-muted',
                        )}
                        title={
                          obligation.due_date
                            ? `${formatDate(obligation.due_date)}${
                                obligation.due_date_basis ? ` · ${obligation.due_date_basis}` : ''
                              }`
                            : 'No due date extracted'
                        }
                      >
                        <CalendarClock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        {obligation.due_date
                          ? `${formatDate(obligation.due_date)} · ${formatRelativeDate(obligation.due_date)}`
                          : EMPTY}
                      </span>

                      {obligation.verification ? (
                        <VerdictChip
                          verdict={obligation.verification.verdict}
                          score={obligation.verification.entailment}
                          size="xs"
                        />
                      ) : (
                        <Badge
                          tone="muted"
                          size="xs"
                          title="No entailment check on record — this obligation was extracted with the verifier disabled"
                        >
                          <ShieldOff aria-hidden="true" className="h-3 w-3 shrink-0" />
                          Unverified
                        </Badge>
                      )}
                    </div>

                    {obligation.verification && (
                      <p className="font-mono text-[10px] tabular-nums text-muted">
                        entail {formatPct(obligation.verification.entailment)} · margin{' '}
                        {formatPct(obligation.verification.margin)} · threshold{' '}
                        {formatPct(obligation.verification.threshold_used)}
                      </p>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

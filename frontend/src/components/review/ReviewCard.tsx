/**
 * One escalation, expandable into the whole case file: why it was escalated,
 * the clause, the claim, the entailment evidence and the agent's reasoning —
 * everything needed to approve or reject without leaving the queue.
 */
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ExternalLink,
  ShieldOff,
  X,
} from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ProbabilityBar from '@/components/ui/ProbabilityBar';
import VerdictChip from '@/components/ui/VerdictChip';
import { Fact, describeError } from '@/components/obligations/PanelStates';
import {
  ACTION_META,
  REVIEW_STATE_META,
  SEVERITY_META,
  isOverdue,
  typeLabel,
} from '@/components/obligations/tokens';
import {
  EMPTY,
  cn,
  formatDate,
  formatNumber,
  formatPct,
  formatRelativeDate,
  humanize,
  truncate,
} from '@/lib/format';
import type { ReviewDecision, ReviewTaskOut } from '@/lib/types';

export interface ReviewCardProps {
  task: ReviewTaskOut;
  expanded: boolean;
  selected: boolean;
  notes: string;
  /** The decision currently being written for this task, if any. */
  pending: ReviewDecision | null;
  /** Error from the last failed resolve of *this* task. */
  error: unknown;
  onToggle: () => void;
  onSelect: () => void;
  onNotesChange: (notes: string) => void;
  onResolve: (decision: ReviewDecision) => void;
  innerRef?: (element: HTMLLIElement | null) => void;
}

export default function ReviewCard({
  task,
  expanded,
  selected,
  notes,
  pending,
  error,
  onToggle,
  onSelect,
  onNotesChange,
  onResolve,
  innerRef,
}: ReviewCardProps) {
  const obligation = task.obligation;
  const verification = obligation?.verification ?? null;
  const decision = obligation?.decision ?? null;
  const stateMeta = REVIEW_STATE_META[task.state];
  const isOpen = task.state === 'open';
  const busy = pending !== null;

  return (
    <li
      ref={innerRef}
      onClick={onSelect}
      onFocusCapture={onSelect}
      className={cn(
        'glass min-w-0 scroll-mt-24 transition-colors duration-240 ease-instrument',
        selected && 'ring-1 ring-accent',
      )}
    >
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-start gap-3 p-3 sm:p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={stateMeta.tone} size="xs">
              {stateMeta.label}
            </Badge>
            <Badge tone="muted" size="xs" mono title="Queue priority — higher is more urgent">
              P{formatNumber(task.priority)}
            </Badge>
            {verification ? (
              <VerdictChip
                verdict={verification.verdict}
                score={verification.entailment}
                size="xs"
              />
            ) : (
              <Badge tone="muted" size="xs">
                <ShieldOff aria-hidden="true" className="h-3 w-3 shrink-0" />
                Unverified
              </Badge>
            )}
            {obligation && (
              <Badge tone={SEVERITY_META[obligation.severity].tone} size="xs">
                {SEVERITY_META[obligation.severity].label}
              </Badge>
            )}
            <span className="text-[11px] text-muted">
              raised {formatRelativeDate(task.created_at)}
            </span>
          </div>

          <h3 className="mt-1.5 truncate text-sm font-medium text-text">
            {obligation?.title ?? `Obligation ${task.obligation_id}`}
          </h3>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            <span className="truncate">{obligation?.contract_title ?? 'Unknown contract'}</span>
            {obligation && (
              <>
                <span aria-hidden="true">·</span>
                <span>{typeLabel(obligation.obligation_type)}</span>
              </>
            )}
          </p>

          {/* why it was escalated — the reason the task exists */}
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-[rgb(var(--uncertain-rgb)/0.3)] bg-[rgb(var(--uncertain-rgb)/0.08)] p-2 text-[11px] leading-relaxed text-uncertain">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 text-text">
              <span className="font-medium text-uncertain">Escalated:</span> {humanize(task.reason)}
            </span>
          </p>

          {!expanded && obligation && (
            <p className="mt-2 truncate font-mono text-[11px] text-muted">
              {truncate(obligation.claim, 140)}
            </p>
          )}
        </div>

        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse the case file' : 'Expand the case file'}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          iconLeft={
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'h-4 w-4 transition-transform duration-240 ease-instrument',
                expanded && 'rotate-180',
              )}
            />
          }
        />
      </div>

      {/* ---------------------------------------------------------- case file */}
      {expanded && (
        <div className="flex flex-col gap-4 border-t border-border p-3 sm:p-4">
          {!obligation ? (
            <p className="text-xs text-muted">
              The API returned this task without its obligation, so there is nothing to review here
              yet. Reload the queue, or open the obligation directly.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    Premise — source clause
                  </p>
                  <blockquote className="max-h-48 overflow-y-auto rounded-lg border border-border bg-[rgb(var(--bg-rgb)/0.6)] p-3">
                    <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text">
                      {obligation.clause?.text ?? 'No clause is linked to this obligation.'}
                    </p>
                  </blockquote>
                  {obligation.clause?.category && (
                    <p className="text-[11px] text-muted">
                      CUAD category{' '}
                      <span className="text-text">{obligation.clause.category}</span> ·{' '}
                      {formatPct(obligation.clause.category_score, 0)}
                    </p>
                  )}
                </div>

                <div className="min-w-0 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    Hypothesis — machine claim
                  </p>
                  <blockquote className="rounded-lg border border-[rgb(var(--accent-rgb)/0.28)] bg-[rgb(var(--accent-rgb)/0.07)] p-3">
                    <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text">
                      {obligation.claim}
                    </p>
                  </blockquote>
                  <dl className="grid grid-cols-2 gap-3 pt-1">
                    <Fact label="Obligor">{obligation.obligor ?? EMPTY}</Fact>
                    <Fact label="Due" mono>
                      {obligation.due_date ? (
                        <span
                          className={
                            isOverdue(obligation.due_date, obligation.status)
                              ? 'text-ungrounded'
                              : undefined
                          }
                        >
                          {formatDate(obligation.due_date)}
                        </span>
                      ) : (
                        EMPTY
                      )}
                    </Fact>
                  </dl>
                </div>
              </div>

              {/* entailment evidence */}
              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  Entailment evidence
                </p>
                {verification ? (
                  <>
                    <ProbabilityBar
                      entailment={verification.entailment}
                      neutral={verification.neutral}
                      contradiction={verification.contradiction}
                      threshold={verification.threshold_used}
                    />
                    <p className="font-mono text-[11px] tabular-nums text-muted">
                      margin {formatPct(verification.margin)} · threshold{' '}
                      {formatPct(verification.threshold_used)} · {verification.model_name} ·{' '}
                      {formatNumber(Math.round(verification.latency_ms))} ms
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted">
                    No verification is attached — this claim was never re-checked against its
                    clause.
                  </p>
                )}
              </div>

              {/* agent reasoning */}
              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Bot aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    Agent reasoning
                  </p>
                  {decision && (
                    <>
                      <Badge tone={ACTION_META[decision.action].tone} size="xs">
                        {ACTION_META[decision.action].label}
                      </Badge>
                      <Badge tone={decision.policy_mode === 'llm' ? 'accent' : 'muted'} size="xs">
                        {decision.policy_mode === 'llm' ? 'LLM policy' : 'Deterministic policy'}
                      </Badge>
                      <span className="font-mono text-[11px] tabular-nums text-muted">
                        confidence {formatPct(decision.confidence, 0)}
                      </span>
                    </>
                  )}
                </div>
                {decision ? (
                  <>
                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text">
                      {decision.rationale.trim() || 'No rationale was recorded.'}
                    </p>
                    {decision.risk_flags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {decision.risk_flags.map((flag) => (
                          <Badge key={flag} tone="uncertain" size="xs">
                            {humanize(flag)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted">No agent decision was recorded.</p>
                )}
              </div>

              <Link
                to={`/obligations/${obligation.id}`}
                className="inline-flex w-fit items-center gap-1.5 text-xs text-accent underline-offset-4 hover:underline"
              >
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                Open the full obligation
              </Link>
            </>
          )}

          {/* ------------------------------------------------------- decision */}
          {isOpen ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <label
                htmlFor={`notes-${task.id}`}
                className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
              >
                Reviewer notes (optional)
              </label>
              <textarea
                id={`notes-${task.id}`}
                value={notes}
                rows={2}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Why you are approving or rejecting — stored with the decision."
                className="w-full min-w-0 resize-y rounded-lg border border-border bg-bg-elev p-2 text-xs text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  loading={pending === 'approve'}
                  onClick={() => onResolve('approve')}
                  iconLeft={<Check aria-hidden="true" className="h-3.5 w-3.5" />}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  loading={pending === 'reject'}
                  onClick={() => onResolve('reject')}
                  iconLeft={<X aria-hidden="true" className="h-3.5 w-3.5" />}
                >
                  Reject
                </Button>
                <span className="text-[11px] text-muted">
                  or press <kbd className="rounded border border-border px-1">a</kbd> /{' '}
                  <kbd className="rounded border border-border px-1">r</kbd>
                </span>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
              <Fact label="Resolved by">{task.reviewer ?? EMPTY}</Fact>
              <Fact label="Resolved" mono>
                {task.resolved_at ? formatRelativeDate(task.resolved_at) : EMPTY}
              </Fact>
              <Fact label="Notes" className="col-span-2">
                {task.notes ?? 'None recorded.'}
              </Fact>
            </dl>
          )}

          {error != null && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.08)] p-2.5 text-xs text-ungrounded"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Decision not saved — {describeError(error)}. The queue has been rolled back.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

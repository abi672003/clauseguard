/**
 * The two columns of the money screen: the clause the model read
 * (PREMISE, verbatim) against the claim it produced from it (HYPOTHESIS).
 * Everything the verifier was given is on the left; everything it was asked to
 * check is on the right.
 */
import { Link } from 'react-router-dom';
import { FileText, Quote, ScanLine } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Fact, Meter } from '@/components/obligations/PanelStates';
import { SEVERITY_META, typeLabel } from '@/components/obligations/tokens';
import { EMPTY, formatNumber, formatPct } from '@/lib/format';
import type { ClauseOut, ObligationDetail } from '@/lib/types';

function ColumnHeading({
  kind,
  title,
  subtitle,
}: {
  kind: 'premise' | 'hypothesis';
  title: string;
  subtitle: string;
}) {
  const Icon = kind === 'premise' ? Quote : ScanLine;
  return (
    <div className="flex items-start gap-2 border-b border-border px-4 py-3">
      <Icon
        aria-hidden="true"
        className={kind === 'premise' ? 'mt-0.5 h-4 w-4 shrink-0 text-muted' : 'mt-0.5 h-4 w-4 shrink-0 text-accent'}
      />
      <div className="min-w-0">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

export interface PremiseHypothesisProps {
  obligation: ObligationDetail;
  clause: ClauseOut | null;
}

export default function PremiseHypothesis({ obligation, clause }: PremiseHypothesisProps) {
  const severity = SEVERITY_META[obligation.severity];

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {/* ------------------------------------------------------------ premise */}
      <section className="glass flex min-w-0 flex-col overflow-hidden">
        <ColumnHeading
          kind="premise"
          title="Premise — source clause"
          subtitle="The contract text, exactly as the verifier received it"
        />

        {clause ? (
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent" size="xs" title="CUAD clause category assigned by the classifier">
                {clause.category ?? 'Uncategorised'}
              </Badge>
              <Badge tone="muted" size="xs" mono title="Classifier confidence for that category">
                {formatPct(clause.category_score)}
              </Badge>
              {clause.runner_up && (
                <Badge tone="muted" size="xs" title="Runner-up category and its score">
                  2nd: {clause.runner_up} · {formatPct(clause.runner_up_score, 0)}
                </Badge>
              )}
              {clause.is_candidate && (
                <Badge tone="grounded" size="xs" title="Survived the prefilter as an obligation candidate">
                  Candidate
                </Badge>
              )}
            </div>

            <blockquote className="max-h-[22rem] min-w-0 overflow-y-auto rounded-lg border border-border bg-[rgb(var(--bg-rgb)/0.6)] p-3">
              <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text">
                {clause.text}
              </p>
            </blockquote>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Clause #" mono>
                {formatNumber(clause.index)}
              </Fact>
              <Fact label="Characters" mono>
                {formatNumber(clause.char_start)}–{formatNumber(clause.char_end)}
              </Fact>
              <Fact label="Prefilter" mono>
                {formatPct(clause.prefilter_score)}
              </Fact>
              <Fact label="Clause ID" mono>
                <span className="break-all">{clause.id}</span>
              </Fact>
            </dl>

            <Link
              to={`/contracts/${obligation.contract_id}`}
              className="inline-flex items-center gap-1.5 text-xs text-accent underline-offset-4 hover:underline"
            >
              <FileText aria-hidden="true" className="h-3.5 w-3.5" />
              Read it in context
            </Link>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              tone="error"
              icon={Quote}
              title="Source clause missing"
              description="This obligation has no clause attached, so its claim cannot be verified against anything. Re-run the analysis on the contract to rebuild the link."
            />
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- hypothesis */}
      <section className="glass flex min-w-0 flex-col overflow-hidden">
        <ColumnHeading
          kind="hypothesis"
          title="Hypothesis — machine claim"
          subtitle="What the extractor asserts the clause obliges"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="accent" size="xs">
              {typeLabel(obligation.obligation_type)}
            </Badge>
            <Badge tone={severity.tone} size="xs">
              {severity.label} severity
            </Badge>
          </div>

          <p className="text-sm font-medium text-text">{obligation.title}</p>

          <blockquote className="min-w-0 rounded-lg border border-[rgb(var(--accent-rgb)/0.28)] bg-[rgb(var(--accent-rgb)/0.07)] p-3">
            <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text">
              {obligation.claim}
            </p>
          </blockquote>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                Extraction confidence
              </span>
              <span className="font-mono text-xs tabular-nums text-text">
                {formatPct(obligation.extraction_confidence)}
              </span>
            </div>
            <Meter
              value={obligation.extraction_confidence}
              label="Extraction confidence"
              color="var(--accent)"
            />
            <p className="text-[11px] text-muted">
              How sure the extractor was of its own reading — not evidence that the clause says
              it. That is what the verifier below is for.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Obligor">{obligation.obligor ?? EMPTY}</Fact>
            <Fact label="Obligee">{obligation.obligee ?? EMPTY}</Fact>
          </dl>
        </div>
      </section>
    </div>
  );
}

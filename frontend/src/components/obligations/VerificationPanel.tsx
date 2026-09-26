/**
 * The evidence panel: the three-way NLI distribution the verifier returned,
 * the calibrated threshold it was judged against, and the verdict that fell
 * out of the comparison. This is the product's whole differentiator, so the
 * arithmetic is shown, not summarised.
 */
import { ShieldOff } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ProbabilityBar from '@/components/ui/ProbabilityBar';
import VerdictChip from '@/components/ui/VerdictChip';
import { Fact } from '@/components/obligations/PanelStates';
import { VERDICT_META } from '@/components/obligations/tokens';
import { formatDateTime, formatNumber, formatPct } from '@/lib/format';
import type { VerificationOut } from '@/lib/types';

export interface VerificationPanelProps {
  verification: VerificationOut | null;
}

/** One sentence stating the rule that produced the verdict. */
function decisionSentence(verification: VerificationOut): string {
  const { entailment, threshold_used: threshold, verdict, contradiction, neutral } = verification;
  const cmp = entailment >= threshold ? '≥' : '<';
  const head = `Entailment ${formatPct(entailment)} ${cmp} threshold ${formatPct(threshold)}`;
  switch (verdict) {
    case 'grounded':
      return `${head} — the clause supports the claim, so it was tracked.`;
    case 'ungrounded':
      return contradiction > neutral
        ? `${head}, and contradiction leads the distribution — the clause argues against the claim.`
        : `${head} — the clause does not support the claim.`;
    case 'uncertain':
      return `${head}, but no class wins clearly — the margin sits inside the indecision band.`;
  }
}

export default function VerificationPanel({ verification }: VerificationPanelProps) {
  if (!verification) {
    return (
      <EmptyState
        tone="error"
        icon={ShieldOff}
        title="No verification on record"
        description="This obligation was produced with the verifier disabled, so nothing re-checked the claim against its clause. Re-analyse the contract with the verifier on before trusting it."
      />
    );
  }

  const meta = VERDICT_META[verification.verdict];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={verification.verdict} score={verification.entailment} />
        <span
          className="font-mono text-xs tabular-nums"
          style={{ color: meta.color }}
          title="Distance between the winning class and the runner-up"
        >
          margin {formatPct(verification.margin)}
        </span>
        <Badge tone="muted" size="xs" mono title="Entailment threshold in force for this run">
          threshold {formatPct(verification.threshold_used)}
        </Badge>
      </div>

      <ProbabilityBar
        entailment={verification.entailment}
        neutral={verification.neutral}
        contradiction={verification.contradiction}
        threshold={verification.threshold_used}
        size="lg"
      />

      <p className="text-xs leading-relaxed text-text">{decisionSentence(verification)}</p>

      {verification.evidence_sentence && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
            Sentence carrying the evidence
          </p>
          <blockquote
            className="rounded-lg border-l-2 bg-surface p-3 font-mono text-[12px] leading-relaxed text-text"
            style={{ borderLeftColor: meta.color }}
          >
            {verification.evidence_sentence}
          </blockquote>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
        <Fact label="Model">
          <span className="break-all font-mono">{verification.model_name}</span>
        </Fact>
        <Fact label="Latency" mono>
          {formatNumber(Math.round(verification.latency_ms))} ms
        </Fact>
        <Fact label="Verified" mono>
          {formatDateTime(verification.created_at)}
        </Fact>
        <Fact label="Verification ID" mono>
          <span className="break-all">{verification.id}</span>
        </Fact>
      </dl>
    </div>
  );
}

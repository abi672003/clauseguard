/**
 * What the agent did with the evidence, and why. The rationale is prose on
 * purpose — a reviewer has to be able to disagree with it in words.
 */
import { Bot, ShieldQuestion, SlidersHorizontal } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Fact, Meter } from '@/components/obligations/PanelStates';
import { ACTION_META, POLICY_MODE_META } from '@/components/obligations/tokens';
import { EMPTY, formatNumber, formatPct, humanize } from '@/lib/format';
import type { AgentDecisionOut } from '@/lib/types';

export interface AgentPanelProps {
  decision: AgentDecisionOut | null;
}

export default function AgentPanel({ decision }: AgentPanelProps) {
  if (!decision) {
    return (
      <EmptyState
        icon={ShieldQuestion}
        title="No agent decision recorded"
        description="The obligation was persisted without passing through the decision policy. Re-run the analysis to produce an auditable decision."
      />
    );
  }

  const action = ACTION_META[decision.action];
  const policy = POLICY_MODE_META[decision.policy_mode];
  const isLlm = decision.policy_mode === 'llm';
  const totalTokens = decision.input_tokens + decision.output_tokens;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={action.tone}>
          <Bot aria-hidden="true" className="h-3 w-3 shrink-0" />
          {action.label}
        </Badge>
        <Badge tone={isLlm ? 'accent' : 'muted'} title={policy.hint}>
          {isLlm ? (
            <Bot aria-hidden="true" className="h-3 w-3 shrink-0" />
          ) : (
            <SlidersHorizontal aria-hidden="true" className="h-3 w-3 shrink-0" />
          )}
          {policy.label}
        </Badge>
        <span className="font-mono text-xs tabular-nums text-muted">
          confidence {formatPct(decision.confidence)}
        </span>
      </div>

      <Meter
        value={decision.confidence}
        label="Agent confidence"
        color={action.color}
      />

      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">Rationale</p>
        <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-text">
          {decision.rationale.trim() || 'The policy recorded no rationale for this decision.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">Risk flags</p>
        {decision.risk_flags.length === 0 ? (
          <p className="text-xs text-muted">None raised.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {decision.risk_flags.map((flag) => (
              <Badge key={flag} tone="uncertain" size="xs">
                {humanize(flag)}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
        <Fact label="Policy">{policy.label}</Fact>
        <Fact label="Model">
          <span className="break-all font-mono">{decision.model_name ?? EMPTY}</span>
        </Fact>
        <Fact label="Tokens" mono>
          {isLlm || totalTokens > 0
            ? `${formatNumber(decision.input_tokens)} in · ${formatNumber(decision.output_tokens)} out`
            : EMPTY}
        </Fact>
        <Fact label="Latency" mono>
          {formatNumber(Math.round(decision.latency_ms))} ms
        </Fact>
      </dl>
    </div>
  );
}

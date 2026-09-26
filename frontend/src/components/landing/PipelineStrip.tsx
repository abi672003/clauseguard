import { Filter, Gavel, ScanText, Scissors, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/format';
import type { PipelineStage } from '@/lib/types';

interface Step {
  /** Keyed to the frozen pipeline contract so the copy cannot drift from the API. */
  stage: PipelineStage;
  label: string;
  detail: string;
  icon: LucideIcon;
  /** The verification step is the product — it is drawn in the accent. */
  pivotal?: boolean;
}

const STEPS: Step[] = [
  {
    stage: 'segment',
    label: 'Segment',
    detail:
      'The contract is cut into clauses with exact character offsets, so every later claim keeps a citable span to point back at.',
    icon: Scissors,
  },
  {
    stage: 'prefilter',
    label: 'Prefilter',
    detail:
      'Each clause is scored for obligation-bearing language. Only the candidates are worth spending a large model on.',
    icon: Filter,
  },
  {
    stage: 'extract',
    label: 'Extract',
    detail:
      'Candidates become structured claims — obligor, obligee, due date, amount, severity — each one still tied to its clause.',
    icon: ScanText,
  },
  {
    stage: 'verify',
    label: 'Verify',
    detail:
      'The clause is the premise, the extracted claim is the hypothesis. An entailment model decides whether the clause actually says it.',
    icon: ShieldCheck,
    pivotal: true,
  },
  {
    stage: 'agent',
    label: 'Adjudicate',
    detail:
      'Entailed claims are auto-tracked. Anything in the indecision band is escalated to a human with its evidence attached.',
    icon: Gavel,
  },
];

export default function PipelineStrip() {
  return (
    <section aria-labelledby="how-it-works" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="how-it-works" className="text-lg font-semibold tracking-tight text-text">
          Five stages, one of which is the point
        </h2>
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Extraction is table stakes — every vendor does it. Stage four is why an obligation in
          ClauseGuard is worth believing.
        </p>
      </div>

      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map(({ stage, label, detail, icon: Icon, pivotal }, index) => (
          <li
            key={stage}
            className={cn(
              'glass flex min-w-0 flex-col gap-2 p-4',
              pivotal && 'border-[rgb(var(--accent-rgb)/0.42)] bg-[rgb(var(--accent-rgb)/0.07)]',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] tabular-nums text-muted">
                {String(index + 1).padStart(2, '0')}
              </span>
              <Icon
                aria-hidden="true"
                className={cn('h-4 w-4 shrink-0', pivotal ? 'text-accent' : 'text-muted')}
              />
            </div>

            <h3
              className={cn(
                'text-sm font-semibold tracking-tight',
                pivotal ? 'text-accent' : 'text-text',
              )}
            >
              {label}
            </h3>

            <p className="text-xs leading-relaxed text-muted">{detail}</p>

            <code className="mt-auto pt-1 text-[10px] uppercase tracking-[0.14em] text-muted">
              {stage}
            </code>
          </li>
        ))}
      </ol>
    </section>
  );
}

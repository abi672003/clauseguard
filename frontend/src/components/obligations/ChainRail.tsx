/**
 * The causal chain, made explicit:
 *   clause -> claim -> entailment evidence -> decision -> status.
 * Each link states what it contributed, so the screen reads as a derivation
 * rather than a pile of panels.
 */
import { Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/format';

export interface ChainStep {
  /** Stage name: Clause, Claim, Entailment, Decision, Status. */
  label: string;
  /** The value this stage produced. */
  value: string;
  /** How it produced it. */
  detail: string;
  icon: LucideIcon;
  /** CSS custom property reference for the stage accent. */
  color: string;
  /** Anchor id on the panel this step summarises. */
  href?: string;
}

export interface ChainRailProps {
  steps: ChainStep[];
}

export default function ChainRail({ steps }: ChainRailProps) {
  return (
    <ol className="flex flex-col gap-1.5 xl:flex-row xl:items-stretch xl:gap-0">
      {steps.map((step, index) => {
        const Icon = step.icon;
        const body = (
          <>
            <span className="flex items-center gap-1.5">
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" style={{ color: step.color }} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                {step.label}
              </span>
            </span>
            <span className="mt-1 block truncate font-mono text-xs tabular-nums text-text">
              {step.value}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{step.detail}</span>
          </>
        );

        return (
          <Fragment key={step.label}>
            {index > 0 && (
              <li aria-hidden="true" className="flex items-center justify-center xl:px-1.5">
                <ChevronRight className="h-4 w-4 rotate-90 text-muted xl:rotate-0" />
              </li>
            )}
            <li className="min-w-0 flex-1">
              {step.href ? (
                <a
                  href={step.href}
                  className={cn(
                    'block h-full min-w-0 rounded-xl border border-border bg-surface p-3',
                    'transition-colors duration-240 ease-instrument hover:border-[rgb(var(--accent-rgb)/0.4)]',
                  )}
                  style={{ borderTopColor: step.color, borderTopWidth: '2px' }}
                >
                  {body}
                </a>
              ) : (
                <div
                  className="block h-full min-w-0 rounded-xl border border-border bg-surface p-3"
                  style={{ borderTopColor: step.color, borderTopWidth: '2px' }}
                >
                  {body}
                </div>
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

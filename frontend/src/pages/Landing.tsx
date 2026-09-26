import { Suspense, lazy } from 'react';
import { ArrowRight, FileText, LayoutDashboard, ShieldCheck } from 'lucide-react';

import CtaLink from '@/components/landing/CtaLink';
import PipelineStrip from '@/components/landing/PipelineStrip';
import ProofStat from '@/components/landing/ProofStat';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/format';
import type { Verdict } from '@/lib/types';

/** Decodes the colours the core tints its shards with. */
const VERDICT_KEY: { verdict: Verdict; label: string; className: string }[] = [
  { verdict: 'grounded', label: 'grounded', className: 'bg-grounded' },
  { verdict: 'uncertain', label: 'uncertain', className: 'bg-uncertain' },
  { verdict: 'ungrounded', label: 'ungrounded', className: 'bg-ungrounded' },
];

/** three.js is lazy so it never lands in the initial bundle. */
const HeroScene = lazy(() => import('@/components/landing/HeroScene'));

/* Scrims keep the headline at full contrast over the moving core. Token-only:
   every colour below is the --bg channel twin at an alpha. */
const SCRIM_VERTICAL =
  'linear-gradient(to bottom, rgb(var(--bg-rgb) / 0.86) 0%, rgb(var(--bg-rgb) / 0.52) 44%, rgb(var(--bg-rgb) / 0.95) 100%)';
const SCRIM_HORIZONTAL =
  'linear-gradient(to right, rgb(var(--bg-rgb) / 0.94) 0%, rgb(var(--bg-rgb) / 0.72) 48%, rgb(var(--bg-rgb) / 0.08) 100%)';

export default function Landing() {
  return (
    <div className="flex min-w-0 flex-col gap-10 sm:gap-14">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative -mx-3 -mt-4 min-w-0 overflow-hidden border-b border-border sm:-mx-5 sm:-mt-6">
        <div aria-hidden="true" className="absolute inset-0">
          <Suspense fallback={<Skeleton className="h-full w-full" rounded="sm" />}>
            <HeroScene />
          </Suspense>
        </div>
        <div aria-hidden="true" className="absolute inset-0" style={{ background: SCRIM_VERTICAL }} />
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden lg:block"
          style={{ background: SCRIM_HORIZONTAL }}
        />

        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-14 sm:px-6 sm:py-20 lg:py-28">
          <p className="animate-rise inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-muted">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent" />
            Contract obligation monitor
          </p>

          <h1
            className="animate-rise max-w-3xl text-3xl font-semibold leading-[1.08] tracking-tight text-text sm:text-5xl lg:text-6xl"
            style={{ animationDelay: '40ms' }}
          >
            Every obligation is checked against the clause it came from
            <span className="text-accent">.</span>
          </h1>

          <div
            className="animate-rise flex max-w-2xl flex-col gap-4"
            style={{ animationDelay: '80ms' }}
          >
            <p className="text-sm leading-relaxed text-muted sm:text-base">
              Published evaluations put large-language-model hallucination rates on legal text
              somewhere between{' '}
              <span className="font-mono tabular-nums text-ungrounded">17%</span> and{' '}
              <span className="font-mono tabular-nums text-ungrounded">88%</span>, depending on the
              model and the question. That is a fatal error rate for software that files your
              deadlines, payments and termination rights.
            </p>
            <p className="text-sm leading-relaxed text-text sm:text-base">
              So ClauseGuard refuses to trust itself. Before an extracted obligation is tracked, an
              entailment model re-reads the exact clause it was drawn from — the clause is the
              premise, the claim is the hypothesis. If the clause does not entail the claim, it
              never reaches your register; it goes to a human with the evidence attached.
            </p>
          </div>

          <div className="animate-rise" style={{ animationDelay: '120ms' }}>
            <ProofStat />
          </div>

          <dl
            className="animate-rise flex flex-wrap items-center gap-x-4 gap-y-1.5"
            style={{ animationDelay: '160ms' }}
          >
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">Shards leave the core</dt>
            {VERDICT_KEY.map(({ verdict, label, className }) => (
              <dd key={verdict} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', className)} />
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  {label}
                </span>
              </dd>
            ))}
          </dl>

          <div
            className="animate-rise flex flex-wrap items-center gap-3"
            style={{ animationDelay: '200ms' }}
          >
            <CtaLink
              to="/dashboard"
              variant="primary"
              iconLeft={<LayoutDashboard aria-hidden="true" className="h-4 w-4 shrink-0" />}
              iconRight={<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
            >
              Open the dashboard
            </CtaLink>
            <CtaLink
              to="/contracts"
              iconLeft={<FileText aria-hidden="true" className="h-4 w-4 shrink-0" />}
            >
              Load contracts
            </CtaLink>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- how it works */}
      <PipelineStrip />

      {/* ---------------------------------------------------- closing note */}
      <section className="glass flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-sm font-semibold tracking-tight text-text">
            The verification step is inspectable, obligation by obligation
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Every tracked obligation carries its source clause, its three-way entailment
            distribution, the threshold it was judged against and the agent&rsquo;s rationale. Nothing
            is asserted that you cannot audit.
          </p>
        </div>
        <CtaLink
          to="/obligations"
          className="shrink-0"
          iconRight={<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
        >
          Browse the register
        </CtaLink>
      </section>
    </div>
  );
}

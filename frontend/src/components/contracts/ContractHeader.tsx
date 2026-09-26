import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Play, TriangleAlert } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ContractStatusBadge from '@/components/contracts/ContractStatusBadge';
import ToggleSwitch from '@/components/contracts/ToggleSwitch';
import { formatMs } from '@/components/contracts/helpers';
import { ApiError } from '@/lib/api';
import { cn, EMPTY, formatDate, formatDateTime, formatNumber, humanize } from '@/lib/format';
import type { ContractDetail } from '@/lib/types';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-xs text-text">{children}</dd>
    </div>
  );
}

export interface ContractHeaderProps {
  contract: ContractDetail;
  verifierEnabled: boolean;
  onVerifierChange: (next: boolean) => void;
  onReanalyze: () => void;
  analyzing?: boolean;
  analyzeError?: unknown;
}

/** Contract metadata, plus the controls that re-run the pipeline over it. */
export default function ContractHeader({
  contract,
  verifierEnabled,
  onVerifierChange,
  onReanalyze,
  analyzing = false,
  analyzeError,
}: ContractHeaderProps) {
  const run = contract.latest_run;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/contracts"
            className="inline-flex items-center gap-1.5 rounded text-[11px] text-muted transition-colors duration-240 ease-instrument hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            All contracts
          </Link>

          <h1 className="mt-1 text-lg font-semibold tracking-tight text-text sm:text-xl">
            {contract.title}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ContractStatusBadge status={contract.status} size="xs" />
            {contract.contract_type && (
              <Badge tone="neutral" size="xs">
                {humanize(contract.contract_type)}
              </Badge>
            )}
            <Badge tone="muted" size="xs" mono title="Ingest source">
              {contract.source}
            </Badge>
            {contract.filename && (
              <Badge tone="muted" size="xs" mono className="max-w-[14rem]" title={contract.filename}>
                {contract.filename}
              </Badge>
            )}
            <Badge tone="muted" size="xs" mono title="Contract id">
              {contract.id}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ToggleSwitch
              checked={verifierEnabled}
              onChange={onVerifierChange}
              label={verifierEnabled ? 'Verifier on' : 'Verifier off'}
              description="Run the entailment verifier on this analysis. Turn it off to see the ablation: what the extractor alone would have tracked."
            />
            <Button
              variant="primary"
              size="md"
              loading={analyzing}
              onClick={onReanalyze}
              iconLeft={<Play aria-hidden="true" className="h-3.5 w-3.5" />}
            >
              Re-analyze
            </Button>
          </div>
          <p className="max-w-xs text-right text-[11px] leading-relaxed text-muted">
            {verifierEnabled
              ? 'Every extracted obligation is re-checked against its source clause before it is tracked.'
              : 'Ablation: obligations will be tracked on the extractor’s word alone, unverified.'}
          </p>
        </div>
      </div>

      {analyzeError != null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.1)] p-2.5 text-xs text-ungrounded"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            {analyzeError instanceof ApiError
              ? analyzeError.message
              : 'The analysis request was rejected.'}
          </span>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 sm:grid-cols-3 xl:grid-cols-6">
        <Field label="Parties" className="col-span-2">
          <span title={`${contract.party_a ?? EMPTY} ↔ ${contract.party_b ?? EMPTY}`}>
            {contract.party_a ?? EMPTY} <span className="text-muted">↔</span>{' '}
            {contract.party_b ?? EMPTY}
          </span>
        </Field>
        <Field label="Governing law">{contract.governing_law ?? EMPTY}</Field>
        <Field label="Effective">
          <span className="font-mono tabular-nums">{formatDate(contract.effective_date)}</span>
        </Field>
        <Field label="Clauses">
          <span className="font-mono tabular-nums">
            {formatNumber(contract.clauses.length)}
            <span className="text-muted">
              {' '}
              / {formatNumber(contract.clauses.filter((clause) => clause.is_candidate).length)} cand
            </span>
          </span>
        </Field>
        <Field label="Obligations">
          <span className="font-mono tabular-nums">
            {formatNumber(contract.obligation_count)}{' '}
            <span className="text-grounded">{contract.tracked_count}</span>
            <span className="text-muted">/</span>
            <span className="text-uncertain">{contract.review_count}</span>
            <span className="text-muted">/</span>
            <span className="text-ungrounded">{contract.rejected_count}</span>
          </span>
        </Field>
        <Field label="Length">
          <span className="font-mono tabular-nums">{formatNumber(contract.char_count)} chars</span>
        </Field>
        <Field label="Ingested">
          <span className="font-mono tabular-nums">{formatDateTime(contract.created_at)}</span>
        </Field>
        <Field label="Processed">
          <span className="font-mono tabular-nums">
            {contract.processed_at ? formatDateTime(contract.processed_at) : EMPTY}
          </span>
        </Field>
        <Field label="Latest run">
          {run ? (
            <span className="font-mono tabular-nums">
              {formatMs(run.total_ms)}{' '}
              <span className={run.verifier_enabled ? 'text-grounded' : 'text-uncertain'}>
                verifier {run.verifier_enabled ? 'on' : 'off'}
              </span>
            </span>
          ) : (
            EMPTY
          )}
        </Field>
      </dl>
    </div>
  );
}

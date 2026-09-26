import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Database, Library, TriangleAlert } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ToggleSwitch from '@/components/contracts/ToggleSwitch';
import { ApiError, seedContracts } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import type { ContractSummary } from '@/lib/types';

/** `SeedRequest.limit` is validated server-side as 1–60. */
const MIN_SEED = 1;
const MAX_SEED = 60;
const PRESETS = [4, 8, 20, 60] as const;

export interface SeedPanelProps {
  onSeeded?: (contracts: ContractSummary[]) => void;
  className?: string;
}

/**
 * The CUAD loader. CUAD is the Atticus Project's Contract Understanding corpus:
 * 510 real commercial contracts annotated by qualified lawyers — the reason
 * nothing in ClauseGuard has to be mocked.
 */
export default function SeedPanel({ onSeeded, className }: SeedPanelProps) {
  const [limit, setLimit] = useState(8);
  const [analyze, setAnalyze] = useState(true);

  const mutation = useMutation({
    mutationFn: () => seedContracts({ limit, analyze }),
    onSuccess: (data) => onSeeded?.(data.seeded),
  });

  const seeded = mutation.data?.seeded ?? [];
  const error = mutation.error;

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--accent-rgb)/0.35)] bg-[rgb(var(--accent-rgb)/0.12)] text-accent">
          <Library aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">Load real CUAD contracts</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            CUAD — the Contract Understanding Atticus Dataset — is{' '}
            <span className="font-mono tabular-nums text-text">510</span> real commercial
            agreements annotated clause-by-clause by qualified lawyers for the Atticus Project.
            Seeding pulls them straight into the pipeline: no synthetic text, no mocked rows.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="seed-limit" className="text-[11px] uppercase tracking-[0.12em] text-muted">
            Contracts to load
          </label>
          <input
            id="seed-limit"
            type="number"
            min={MIN_SEED}
            max={MAX_SEED}
            value={limit}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(next)) return;
              setLimit(Math.min(MAX_SEED, Math.max(MIN_SEED, next)));
            }}
            className="h-8 w-20 rounded-lg border border-border bg-surface px-2 text-right font-mono text-sm tabular-nums text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <input
          type="range"
          min={MIN_SEED}
          max={MAX_SEED}
          value={limit}
          aria-label="Number of CUAD contracts to load"
          onChange={(event) => setLimit(Number.parseInt(event.target.value, 10))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgb(var(--surface-rgb)/0.1)] accent-[var(--accent)]"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setLimit(preset)}
              aria-pressed={limit === preset}
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors duration-240 ease-instrument',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                limit === preset
                  ? 'border-[rgb(var(--accent-rgb)/0.45)] bg-[rgb(var(--accent-rgb)/0.14)] text-accent'
                  : 'border-border bg-surface text-muted hover:text-text',
              )}
            >
              {preset}
            </button>
          ))}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">
            max {MAX_SEED} per request
          </span>
        </div>
      </div>

      <ToggleSwitch
        checked={analyze}
        onChange={setAnalyze}
        label="Analyse after loading"
        description="Run the full extraction and verification pipeline on each seeded contract"
        className="self-start"
      />

      <Button
        variant="primary"
        size="md"
        block
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
        iconLeft={<Database aria-hidden="true" className="h-4 w-4" />}
      >
        {mutation.isPending
          ? `Loading ${formatNumber(limit)} contracts…`
          : `Load ${formatNumber(limit)} CUAD contracts`}
      </Button>

      {mutation.isPending && (
        <p className="text-[11px] leading-relaxed text-muted" role="status">
          Real documents are being segmented, extracted and verified — this takes a moment per
          contract. The table below updates as each one lands.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.1)] p-2.5 text-xs text-ungrounded"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            {error instanceof ApiError ? error.message : 'Could not load the CUAD sample.'}
          </span>
        </p>
      )}

      {mutation.isSuccess && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <Badge tone="grounded" mono>
            +{seeded.length} loaded
          </Badge>
          {seeded.slice(0, 2).map((contract) => (
            <Badge key={contract.id} tone="muted" className="max-w-[12rem]" title={contract.title}>
              {contract.title}
            </Badge>
          ))}
          {seeded.length > 2 && <Badge tone="muted" mono>+{seeded.length - 2} more</Badge>}
        </div>
      )}
    </div>
  );
}

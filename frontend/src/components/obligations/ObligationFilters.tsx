/**
 * The register's filter bar. It owns no state of its own except the debounce
 * buffer for the text box — the page keeps the truth in the URL so a filtered
 * view is a shareable link.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';

import Button from '@/components/ui/Button';
import {
  OBLIGATION_STATUSES,
  OBLIGATION_TYPES,
  SEVERITIES,
  SEVERITY_META,
  STATUS_META,
  VERDICTS,
  VERDICT_META,
  typeLabel,
} from '@/components/obligations/tokens';
import { describeError } from '@/components/obligations/PanelStates';
import { listContracts } from '@/lib/api';
import { cn, truncate } from '@/lib/format';
import type { ObligationStatus, ObligationType, Severity, Verdict } from '@/lib/types';

export interface ObligationFilterValues {
  status?: ObligationStatus;
  type?: ObligationType;
  severity?: Severity;
  verdict?: Verdict;
  contractId?: string;
  /** ISO date (YYYY-MM-DD). */
  dueBefore?: string;
  q?: string;
}

export interface ObligationFiltersProps {
  value: ObligationFilterValues;
  onChange: (patch: Partial<ObligationFilterValues>) => void;
  onReset: () => void;
  /** Calendar mode cannot filter on verdict — the calendar payload carries no verification. */
  verdictDisabled?: boolean;
  /** Free-form result count rendered beside the reset button. */
  summary?: ReactNode;
}

const CONTROL =
  'h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elev px-2 text-xs text-text ' +
  'transition-colors duration-240 ease-instrument hover:border-[rgb(var(--accent-rgb)/0.4)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export default function ObligationFilters({
  value,
  onChange,
  onReset,
  verdictDisabled = false,
  summary,
}: ObligationFiltersProps) {
  const uid = useId();
  const [text, setText] = useState<string>(value.q ?? '');

  // Adopt an externally-driven change (reset, back button, shared link).
  useEffect(() => {
    setText(value.q ?? '');
  }, [value.q]);

  // Debounce typing so every keystroke does not become a request.
  useEffect(() => {
    const committed = value.q ?? '';
    const next = text.trim();
    if (next === committed) return undefined;
    const timer = window.setTimeout(() => {
      onChange({ q: next === '' ? undefined : next });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, value.q, onChange]);

  const contracts = useQuery({
    queryKey: ['contracts', { limit: 200, offset: 0 }],
    queryFn: () => listContracts({ limit: 200 }),
    staleTime: 60_000,
  });

  const pick = useCallback(
    <K extends keyof ObligationFilterValues>(key: K) =>
      (raw: string) =>
        onChange({ [key]: raw === '' ? undefined : raw } as Partial<ObligationFilterValues>),
    [onChange],
  );

  const activeCount = [
    value.status,
    value.type,
    value.severity,
    value.verdict,
    value.contractId,
    value.dueBefore,
    value.q,
  ].filter(Boolean).length;

  const contractOptions = contracts.data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-7">
        <Field label="Search" htmlFor={`${uid}-q`} className="col-span-2 sm:col-span-3 xl:col-span-1">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
            />
            <input
              id={`${uid}-q`}
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Title, claim, party…"
              className={cn(CONTROL, 'pl-7')}
            />
          </div>
        </Field>

        <Field label="Status" htmlFor={`${uid}-status`}>
          <select
            id={`${uid}-status`}
            className={CONTROL}
            value={value.status ?? ''}
            onChange={(event) => pick('status')(event.target.value)}
          >
            <option value="">Any status</option>
            {OBLIGATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_META[status].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Type" htmlFor={`${uid}-type`}>
          <select
            id={`${uid}-type`}
            className={CONTROL}
            value={value.type ?? ''}
            onChange={(event) => pick('type')(event.target.value)}
          >
            <option value="">Any type</option>
            {OBLIGATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Severity" htmlFor={`${uid}-severity`}>
          <select
            id={`${uid}-severity`}
            className={CONTROL}
            value={value.severity ?? ''}
            onChange={(event) => pick('severity')(event.target.value)}
          >
            <option value="">Any severity</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {SEVERITY_META[severity].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Verdict" htmlFor={`${uid}-verdict`}>
          <select
            id={`${uid}-verdict`}
            className={CONTROL}
            disabled={verdictDisabled}
            title={
              verdictDisabled
                ? 'The calendar feed carries no verification, so verdict cannot be filtered here.'
                : undefined
            }
            value={value.verdict ?? ''}
            onChange={(event) => pick('verdict')(event.target.value)}
          >
            <option value="">Any verdict</option>
            {VERDICTS.map((verdict) => (
              <option key={verdict} value={verdict}>
                {VERDICT_META[verdict].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Contract" htmlFor={`${uid}-contract`}>
          <select
            id={`${uid}-contract`}
            className={CONTROL}
            disabled={contracts.isPending || contracts.isError}
            value={value.contractId ?? ''}
            onChange={(event) => pick('contractId')(event.target.value)}
            title={contracts.isError ? describeError(contracts.error) : undefined}
          >
            <option value="">
              {contracts.isPending
                ? 'Loading contracts…'
                : contracts.isError
                  ? 'Contracts unavailable'
                  : 'Any contract'}
            </option>
            {contractOptions.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {truncate(contract.title, 48)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due before" htmlFor={`${uid}-due`}>
          <input
            id={`${uid}-due`}
            type="date"
            className={CONTROL}
            value={value.dueBefore ?? ''}
            onChange={(event) => pick('dueBefore')(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{summary}</p>
        <div className="flex items-center gap-2">
          {contracts.isError && (
            <span className="text-[11px] text-ungrounded">
              Contract list unavailable — other filters still work.
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={activeCount === 0}
            iconLeft={<X aria-hidden="true" className="h-3.5 w-3.5" />}
          >
            Clear{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}

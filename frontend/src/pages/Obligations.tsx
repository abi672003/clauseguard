/**
 * /obligations — the register.
 *
 * Every filter lives in the URL, so any view of the register is a shareable
 * link. Two modes share those filters: a dense table (the paginated
 * `listObligations` feed) and a month calendar (`getCalendar`).
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Table2 } from 'lucide-react';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ObligationCalendar, { currentMonth } from '@/components/obligations/ObligationCalendar';
import ObligationFilters, {
  type ObligationFilterValues,
} from '@/components/obligations/ObligationFilters';
import ObligationTable, {
  type SortDir,
  type SortKey,
} from '@/components/obligations/ObligationTable';
import {
  OBLIGATION_STATUSES,
  OBLIGATION_TYPES,
  SEVERITIES,
  VERDICTS,
  asEnum,
  asIsoDate,
  asPositiveInt,
} from '@/components/obligations/tokens';
import { listObligations, type ListObligationsParams } from '@/lib/api';
import { cn, formatNumber, severityRank } from '@/lib/format';
import type { ObligationDetail } from '@/lib/types';

type ViewMode = 'table' | 'calendar';

const SORT_KEYS: readonly SortKey[] = ['due_date', 'severity', 'entailment', 'created_at', 'title'];
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_LIMIT = 25;

/** URL search-param keys, so the two sides of the sync cannot drift. */
const PARAM = {
  status: 'status',
  type: 'type',
  severity: 'severity',
  verdict: 'verdict',
  contractId: 'contract',
  dueBefore: 'due_before',
  q: 'q',
} as const;

function compareBy(a: ObligationDetail, b: ObligationDetail, key: SortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'severity':
      return severityRank(a.severity) - severityRank(b.severity);
    case 'entailment':
      return (a.verification?.entailment ?? -1) - (b.verification?.entailment ?? -1);
    case 'created_at':
      return a.created_at.localeCompare(b.created_at);
    case 'due_date':
      return (a.due_date ?? '').localeCompare(b.due_date ?? '');
  }
}

/** Sorts the loaded page. Rows with no due date always sink to the bottom. */
function sortRows(rows: ObligationDetail[], key: SortKey, dir: SortDir): ObligationDetail[] {
  const sign = dir === 'asc' ? 1 : -1;
  const dated = key === 'due_date' ? rows.filter((row) => row.due_date) : rows;
  const undated = key === 'due_date' ? rows.filter((row) => !row.due_date) : [];
  return [...[...dated].sort((a, b) => compareBy(a, b, key) * sign), ...undated];
}

export default function Obligations() {
  const [params, setParams] = useSearchParams();

  const view: ViewMode = params.get('view') === 'calendar' ? 'calendar' : 'table';
  const month = params.get('month') ?? currentMonth();
  const limit = asPositiveInt(params.get('limit'), DEFAULT_LIMIT, 200) || DEFAULT_LIMIT;
  const offset = asPositiveInt(params.get('offset'), 0);
  const sort = asEnum(SORT_KEYS, params.get('sort')) ?? 'due_date';
  const dir: SortDir = params.get('dir') === 'desc' ? 'desc' : 'asc';

  const filters: ObligationFilterValues = useMemo(
    () => ({
      status: asEnum(OBLIGATION_STATUSES, params.get(PARAM.status)),
      type: asEnum(OBLIGATION_TYPES, params.get(PARAM.type)),
      severity: asEnum(SEVERITIES, params.get(PARAM.severity)),
      verdict: asEnum(VERDICTS, params.get(PARAM.verdict)),
      contractId: params.get(PARAM.contractId) ?? undefined,
      dueBefore: asIsoDate(params.get(PARAM.dueBefore)),
      q: params.get(PARAM.q) ?? undefined,
    }),
    [params],
  );

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const patchParams = useCallback(
    (patch: Record<string, string | undefined>, resetOffset = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, raw] of Object.entries(patch)) {
            if (raw === undefined || raw === '') next.delete(key);
            else next.set(key, raw);
          }
          if (resetOffset) next.delete('offset');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const handleFilterChange = useCallback(
    (patch: Partial<ObligationFilterValues>) => {
      const mapped: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(patch)) {
        const param = PARAM[key as keyof typeof PARAM];
        if (param) mapped[param] = value === undefined ? undefined : String(value);
      }
      patchParams(mapped);
    },
    [patchParams],
  );

  const handleReset = useCallback(() => {
    patchParams(Object.fromEntries(Object.values(PARAM).map((key) => [key, undefined])));
  }, [patchParams]);

  const handleSort = useCallback(
    (key: SortKey) => {
      const nextDir: SortDir = key === sort && dir === 'asc' ? 'desc' : 'asc';
      patchParams({ sort: key, dir: nextDir }, false);
    },
    [dir, sort, patchParams],
  );

  const listParams: ListObligationsParams = useMemo(
    () => ({
      status: filters.status,
      type: filters.type,
      severity: filters.severity,
      verdict: filters.verdict,
      contract_id: filters.contractId,
      due_before: filters.dueBefore,
      q: filters.q,
      limit,
      offset,
    }),
    [filters, limit, offset],
  );

  const query = useQuery({
    queryKey: ['obligations', 'list', listParams],
    queryFn: () => listObligations(listParams),
    placeholderData: keepPreviousData,
    enabled: view === 'table',
  });

  const total = query.data?.total ?? 0;
  const rows = useMemo(
    () => sortRows(query.data?.items ?? [], sort, dir),
    [query.data, sort, dir],
  );

  const firstShown = total === 0 ? 0 : offset + 1;
  const lastShown = Math.min(offset + rows.length, total);

  const summary =
    view === 'calendar' ? (
      'Filters apply to the calendar client-side, except verdict.'
    ) : query.isPending ? (
      'Loading the register…'
    ) : query.isError ? (
      'The register could not be loaded.'
    ) : total === 0 ? (
      'No obligations match.'
    ) : (
      <>
        Showing{' '}
        <span className="font-mono tabular-nums text-text">
          {formatNumber(firstShown)}–{formatNumber(lastShown)}
        </span>{' '}
        of <span className="font-mono tabular-nums text-text">{formatNumber(total)}</span>{' '}
        obligation{total === 1 ? '' : 's'}
        {activeFilterCount > 0 ? ' matching the filters' : ''}
      </>
    );

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-text">Obligation register</h1>
          <p className="mt-0.5 text-xs text-muted">
            Every obligation the pipeline extracted, with the verdict its source clause earned.
          </p>
        </div>

        <div
          role="group"
          aria-label="View mode"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface p-1"
        >
          {(
            [
              { mode: 'table' as const, label: 'Table', icon: Table2 },
              { mode: 'calendar' as const, label: 'Calendar', icon: CalendarDays },
            ]
          ).map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              onClick={() => patchParams({ view: mode === 'table' ? undefined : mode }, false)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors duration-240 ease-instrument',
                view === mode
                  ? 'bg-[rgb(var(--accent-rgb)/0.16)] text-accent'
                  : 'text-muted hover:text-text',
              )}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <Card title="Filters" subtitle="Sync to the URL — copy the address bar to share this view">
        <ObligationFilters
          value={filters}
          onChange={handleFilterChange}
          onReset={handleReset}
          verdictDisabled={view === 'calendar'}
          summary={summary}
        />
      </Card>

      {view === 'calendar' ? (
        <Card padded>
          <ObligationCalendar
            month={month}
            onMonthChange={(next) => patchParams({ month: next }, false)}
            filters={filters}
          />
        </Card>
      ) : (
        <Card
          padded={false}
          bodyClassName="p-3 sm:p-4"
          title="Register"
          subtitle={
            query.isFetching && !query.isPending ? 'Refreshing…' : 'Sorting applies to this page'
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Rows
                <select
                  value={limit}
                  onChange={(event) => patchParams({ limit: event.target.value })}
                  className="h-8 rounded-lg border border-border bg-bg-elev px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-muted">
                  {formatNumber(firstShown)}–{formatNumber(lastShown)} / {formatNumber(total)}
                </span>
                <Button
                  size="sm"
                  aria-label="Previous page"
                  disabled={offset === 0 || query.isPending}
                  onClick={() =>
                    patchParams({ offset: String(Math.max(0, offset - limit)) }, false)
                  }
                  iconLeft={<ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />}
                />
                <Button
                  size="sm"
                  aria-label="Next page"
                  disabled={offset + limit >= total || query.isPending}
                  onClick={() => patchParams({ offset: String(offset + limit) }, false)}
                  iconLeft={<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />}
                />
              </div>
            </div>
          }
        >
          <ObligationTable
            items={rows}
            loading={query.isPending}
            error={query.isError ? query.error : null}
            onRetry={() => void query.refetch()}
            isFiltered={activeFilterCount > 0}
            onClearFilters={handleReset}
            sort={sort}
            dir={dir}
            onSort={handleSort}
          />
        </Card>
      )}
    </div>
  );
}

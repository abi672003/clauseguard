import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ContractsTable, {
  DEFAULT_SORT,
  sortContracts,
  type SortKey,
  type SortState,
} from '@/components/contracts/ContractsTable';
import SeedPanel from '@/components/contracts/SeedPanel';
import UploadDropzone from '@/components/contracts/UploadDropzone';
import { anyInFlight, CONTRACT_STATUSES } from '@/components/contracts/helpers';
import { ApiError, deleteContract, listContracts } from '@/lib/api';
import { cn, formatNumber, humanize } from '@/lib/format';

const PAGE_SIZE = 50;
const POLL_MS = 3_000;
const ASCENDING_FIRST: SortKey[] = ['title', 'contract_type', 'status'];

export default function Contracts() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  /* debounce the search box so every keystroke is not a request */
  useEffect(() => {
    const handle = window.setTimeout(() => setApplied(search.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [applied, status]);

  const contracts = useQuery({
    queryKey: ['contracts', { q: applied, status, offset, limit: PAGE_SIZE }],
    queryFn: () =>
      listContracts({
        q: applied || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
    // Poll while the pipeline still has work in flight, then fall silent.
    refetchInterval: (latest) => (anyInFlight(latest.state.data?.items) ? POLL_MS : false),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['contracts'] });
  }, [queryClient]);

  const removal = useMutation({
    mutationFn: (id: string) => deleteContract(id),
    onSuccess: invalidate,
  });

  const items = useMemo(
    () => sortContracts(contracts.data?.items ?? [], sort),
    [contracts.data?.items, sort],
  );
  const total = contracts.data?.total ?? 0;
  const live = anyInFlight(contracts.data?.items);
  const inFlightCount = (contracts.data?.items ?? []).filter(
    (contract) => contract.status === 'processing',
  ).length;
  const filtered = Boolean(applied || status);

  const onSortChange = useCallback((key: SortKey) => {
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: ASCENDING_FIRST.includes(key) ? 'asc' : 'desc' },
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setApplied('');
    setStatus('');
  }, []);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex min-w-0 flex-col gap-4 animate-rise">
      {/* ------------------------------------------------------------ head */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text">Contracts</h1>
          <p className="mt-1 text-xs text-muted">
            Every ingested agreement, its pipeline status, and what the verifier did with the
            obligations drawn from it.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {live && (
            <Badge tone="accent" mono size="sm" title="Polling every 3 seconds while analysis runs">
              <RefreshCw aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
              {inFlightCount > 0 ? `${inFlightCount} processing` : 'queued'}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void contracts.refetch()}
            loading={contracts.isFetching && !live}
            iconLeft={<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        </div>
      </header>

      {/* -------------------------------------------------------- ingestion */}
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Upload" subtitle="PDF, DOCX or plain text — dropped or browsed">
          <UploadDropzone onUploaded={invalidate} />
        </Card>
        <Card title="CUAD sample" subtitle="Real, expert-annotated commercial contracts">
          <SeedPanel onSeeded={invalidate} />
        </Card>
      </div>

      {/* ------------------------------------------------------------ table */}
      <Card
        padded={false}
        title="Register"
        subtitle={
          contracts.isSuccess
            ? `${formatNumber(total)} contract${total === 1 ? '' : 's'}${filtered ? ' matching' : ''}`
            : 'Loading contracts'
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title, party, text…"
                aria-label="Search contracts"
                className="h-8 w-44 rounded-lg border border-border bg-surface pl-8 pr-2 text-xs text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:w-56"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
              {(['', ...CONTRACT_STATUSES] as const).map((value) => (
                <button
                  key={value || 'all'}
                  type="button"
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-240 ease-instrument',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    status === value
                      ? 'border-[rgb(var(--accent-rgb)/0.45)] bg-[rgb(var(--accent-rgb)/0.14)] text-accent'
                      : 'border-border bg-surface text-muted hover:text-text',
                  )}
                >
                  {value ? humanize(value) : 'All'}
                </button>
              ))}
            </div>
          </div>
        }
        footer={
          contracts.isSuccess && total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] tabular-nums">
                {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} of {formatNumber(total)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                  iconLeft={<ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={rangeEnd >= total}
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                  iconRight={<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {removal.isError && (
          <p
            role="alert"
            className="flex items-start gap-2 border-b border-border bg-[rgb(var(--ungrounded-rgb)/0.08)] px-4 py-2.5 text-xs text-ungrounded"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              {removal.error instanceof ApiError
                ? removal.error.message
                : 'Could not delete that contract.'}
            </span>
          </p>
        )}

        {contracts.isError ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              tone="error"
              icon={TriangleAlert}
              title="Could not load contracts"
              description={
                contracts.error instanceof ApiError
                  ? contracts.error.message
                  : 'The contracts endpoint did not respond.'
              }
              action={
                <Button variant="secondary" size="sm" onClick={() => void contracts.refetch()}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : contracts.isPending ? (
          <ContractsTable
            loading
            items={[]}
            sort={sort}
            onSortChange={onSortChange}
            onDelete={() => undefined}
          />
        ) : items.length === 0 ? (
          <div className="p-4 sm:p-5">
            {filtered ? (
              <EmptyState
                icon={Search}
                title="No contracts match those filters"
                description="Nothing in the register matches the current search and status filter."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearFilters}
                    iconLeft={<X aria-hidden="true" className="h-3.5 w-3.5" />}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="No contracts yet — load the CUAD sample"
                description="Use the CUAD panel above to pull in real, lawyer-annotated commercial contracts, or drop a PDF, DOCX or TXT into the upload zone."
              />
            )}
          </div>
        ) : (
          <ContractsTable
            items={items}
            sort={sort}
            onSortChange={onSortChange}
            onDelete={(id) => removal.mutate(id)}
            deletingId={removal.isPending ? (removal.variables ?? null) : null}
          />
        )}
      </Card>
    </div>
  );
}

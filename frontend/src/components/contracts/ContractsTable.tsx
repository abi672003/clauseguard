import { useCallback, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import ContractStatusBadge from '@/components/contracts/ContractStatusBadge';
import { cn, EMPTY, formatDate, formatNumber, humanize, truncate } from '@/lib/format';
import type { ContractSummary } from '@/lib/types';

/* ------------------------------------------------------------------ sort */
export type SortKey =
  | 'title'
  | 'contract_type'
  | 'status'
  | 'char_count'
  | 'obligation_count'
  | 'tracked_count'
  | 'review_count'
  | 'rejected_count'
  | 'created_at';

export interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export const DEFAULT_SORT: SortState = { key: 'created_at', direction: 'desc' };

function compare(a: ContractSummary, b: ContractSummary, key: SortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'contract_type':
      return (a.contract_type ?? '').localeCompare(b.contract_type ?? '');
    case 'status':
      return a.status.localeCompare(b.status);
    case 'created_at':
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    default:
      return a[key] - b[key];
  }
}

/** Sorts the current page of results. The API has no sort parameter. */
export function sortContracts(
  items: readonly ContractSummary[],
  sort: SortState,
): ContractSummary[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return items
    .slice()
    .sort((a, b) => compare(a, b, sort.key) * factor || a.id.localeCompare(b.id));
}

/* --------------------------------------------------------------- columns */
interface Column {
  key: SortKey;
  label: string;
  /** Responsive visibility — the table must stay readable at 400px. */
  cellClass: string;
  numeric?: boolean;
  title?: string;
}

const COLUMNS: Column[] = [
  { key: 'title', label: 'Contract', cellClass: '' },
  { key: 'contract_type', label: 'Type', cellClass: 'hidden lg:table-cell' },
  { key: 'status', label: 'Status', cellClass: '' },
  {
    key: 'char_count',
    label: 'Length',
    cellClass: 'hidden xl:table-cell',
    numeric: true,
    title: 'Characters of contract text. Clause counts are on the contract detail screen.',
  },
  { key: 'obligation_count', label: 'Obligations', cellClass: '', numeric: true },
  { key: 'created_at', label: 'Created', cellClass: 'hidden md:table-cell', numeric: true },
];

export interface ContractsTableProps {
  items: readonly ContractSummary[];
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  onDelete: (id: string) => void;
  deletingId?: string | null;
  loading?: boolean;
  skeletonRows?: number;
}

/**
 * The contract register. Rows route to the detail screen; deletion goes through
 * an inline two-step confirmation (never `window.confirm`).
 */
export default function ContractsTable({
  items,
  sort,
  onSortChange,
  onDelete,
  deletingId = null,
  loading = false,
  skeletonRows = 6,
}: ContractsTableProps) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<string | null>(null);

  const openContract = useCallback(
    (id: string) => {
      navigate(`/contracts/${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  const onRowClick = useCallback(
    (event: MouseEvent<HTMLTableRowElement>, id: string) => {
      if (confirming) return;
      const target = event.target as HTMLElement;
      if (target.closest('a,button')) return;
      openContract(id);
    },
    [confirming, openContract],
  );

  const onRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === 'Escape') setConfirming(null);
    },
    [],
  );

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[540px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  title={column.title}
                  aria-sort={
                    active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted',
                    column.numeric && 'text-right',
                    column.cellClass,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSortChange(column.key)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded transition-colors duration-240 ease-instrument',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      active ? 'text-text' : 'hover:text-text',
                      column.numeric && 'flex-row-reverse',
                    )}
                  >
                    <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                    {column.label}
                  </button>
                </th>
              );
            })}
            <th scope="col" className="w-10 px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={`skeleton-${index}`} className="border-b border-border">
                  {COLUMNS.map((column) => (
                    <td key={column.key} className={cn('px-3 py-3', column.cellClass)}>
                      <Skeleton className="h-3.5" />
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <Skeleton className="h-3.5 w-4" />
                  </td>
                </tr>
              ))
            : items.map((contract) => {
                const isConfirming = confirming === contract.id;
                return (
                  <tr
                    key={contract.id}
                    onClick={(event) => onRowClick(event, contract.id)}
                    onKeyDown={onRowKeyDown}
                    className={cn(
                      'group cursor-pointer border-b border-border align-middle transition-colors duration-240 ease-instrument',
                      'hover:bg-[rgb(var(--surface-rgb)/0.05)]',
                      isConfirming && 'bg-[rgb(var(--ungrounded-rgb)/0.07)]',
                    )}
                  >
                    {/* contract */}
                    <td className="max-w-[16rem] px-3 py-2.5">
                      <Link
                        to={`/contracts/${encodeURIComponent(contract.id)}`}
                        className="block truncate font-medium text-text underline-offset-4 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        title={contract.title}
                      >
                        {contract.title}
                      </Link>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                        <span className="truncate font-mono" title={contract.filename ?? undefined}>
                          {contract.filename ? truncate(contract.filename, 28) : humanize(contract.source)}
                        </span>
                        <span aria-hidden="true" className="h-2.5 w-px bg-border" />
                        <span className="font-mono uppercase">{contract.source}</span>
                      </span>
                    </td>

                    {/* type + parties */}
                    <td className="hidden max-w-[14rem] px-3 py-2.5 lg:table-cell">
                      {contract.contract_type ? (
                        <Badge tone="neutral" size="xs">
                          {humanize(contract.contract_type)}
                        </Badge>
                      ) : (
                        <span className="text-muted">{EMPTY}</span>
                      )}
                      <span
                        className="mt-1 block truncate text-[11px] text-muted"
                        title={`${contract.party_a ?? EMPTY} ↔ ${contract.party_b ?? EMPTY}`}
                      >
                        {contract.party_a ?? EMPTY} <span className="text-border">↔</span>{' '}
                        {contract.party_b ?? EMPTY}
                      </span>
                    </td>

                    {/* status */}
                    <td className="px-3 py-2.5">
                      <ContractStatusBadge status={contract.status} size="xs" />
                    </td>

                    {/* length */}
                    <td className="hidden px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted xl:table-cell">
                      {formatNumber(contract.char_count)}
                    </td>

                    {/* obligations, split by disposition */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono text-sm tabular-nums text-text">
                          {formatNumber(contract.obligation_count)}
                        </span>
                        <span className="flex items-center gap-1">
                          <span
                            className="font-mono text-[11px] tabular-nums text-grounded"
                            title={`${contract.tracked_count} auto-tracked`}
                          >
                            {contract.tracked_count}
                          </span>
                          <span aria-hidden="true" className="text-border">
                            /
                          </span>
                          <span
                            className="font-mono text-[11px] tabular-nums text-uncertain"
                            title={`${contract.review_count} awaiting human review`}
                          >
                            {contract.review_count}
                          </span>
                          <span aria-hidden="true" className="text-border">
                            /
                          </span>
                          <span
                            className="font-mono text-[11px] tabular-nums text-ungrounded"
                            title={`${contract.rejected_count} rejected`}
                          >
                            {contract.rejected_count}
                          </span>
                        </span>
                      </div>
                      <span className="mt-0.5 block text-right text-[10px] uppercase tracking-wide text-muted">
                        tracked / review / rejected
                      </span>
                    </td>

                    {/* created */}
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted md:table-cell">
                      {formatDate(contract.created_at)}
                    </td>

                    {/* delete, with an inline two-step confirm */}
                    <td className="px-3 py-2.5 text-right">
                      {isConfirming ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="hidden text-[11px] text-ungrounded sm:inline">
                            Delete?
                          </span>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={deletingId === contract.id}
                            onClick={() => {
                              onDelete(contract.id);
                              setConfirming(null);
                            }}
                          >
                            Confirm
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${contract.title}`}
                          onClick={() => setConfirming(contract.id)}
                          className="opacity-60 transition-opacity duration-240 ease-instrument hover:text-ungrounded group-hover:opacity-100"
                          iconLeft={<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}

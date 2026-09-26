/**
 * The register in table form. One row per obligation, carrying the whole
 * causal chain in miniature: what was claimed, what the verifier said, what
 * the agent did with it, and when it falls due.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, ListChecks, ShieldOff } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import VerdictChip from '@/components/ui/VerdictChip';
import { ErrorPanel, SkeletonRows } from '@/components/obligations/PanelStates';
import {
  SEVERITY_META,
  STATUS_META,
  isOverdue,
  typeLabel,
} from '@/components/obligations/tokens';
import { cn, formatDate, formatRelativeDate, truncate } from '@/lib/format';
import type { ObligationDetail } from '@/lib/types';

export type SortKey = 'due_date' | 'severity' | 'entailment' | 'created_at' | 'title';
export type SortDir = 'asc' | 'desc';

export interface ObligationTableProps {
  items: ObligationDetail[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** True when any filter is set — changes the empty-state advice. */
  isFiltered: boolean;
  onClearFilters: () => void;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: 'title', label: 'Obligation', className: 'w-[34%]' },
  { key: null, label: 'Type' },
  { key: 'severity', label: 'Severity' },
  { key: 'entailment', label: 'Verification' },
  { key: 'due_date', label: 'Due' },
  { key: null, label: 'Status' },
];

function VerificationCell({ obligation }: { obligation: ObligationDetail }) {
  const verification = obligation.verification;
  if (!verification) {
    return (
      <Badge tone="muted" size="xs" title="This obligation was produced with the verifier disabled.">
        <ShieldOff aria-hidden="true" className="h-3 w-3 shrink-0" />
        Unverified
      </Badge>
    );
  }
  return <VerdictChip verdict={verification.verdict} score={verification.entailment} size="xs" />;
}

function DueCell({ obligation }: { obligation: ObligationDetail }) {
  if (!obligation.due_date) {
    return <span className="text-xs text-muted">No date</span>;
  }
  const overdue = isOverdue(obligation.due_date, obligation.status);
  return (
    <span className="flex min-w-0 flex-col">
      <span
        className={cn('font-mono text-xs tabular-nums', overdue ? 'text-ungrounded' : 'text-text')}
      >
        {formatDate(obligation.due_date)}
      </span>
      <span
        className={cn(
          'flex items-center gap-1 text-[11px]',
          overdue ? 'text-ungrounded' : 'text-muted',
        )}
      >
        {overdue && <AlertTriangle aria-hidden="true" className="h-3 w-3 shrink-0" />}
        {overdue ? 'Overdue' : formatRelativeDate(obligation.due_date)}
      </span>
    </span>
  );
}

function TitleCell({ obligation }: { obligation: ObligationDetail }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <Link
        to={`/obligations/${obligation.id}`}
        className="truncate text-sm font-medium text-text underline-offset-4 transition-colors duration-240 ease-instrument hover:text-accent hover:underline focus-visible:text-accent"
      >
        {obligation.title}
      </Link>
      <span className="truncate text-[11px] text-muted">
        {obligation.contract_title ?? 'Unknown contract'}
      </span>
    </span>
  );
}

function Empty({
  isFiltered,
  onClearFilters,
}: {
  isFiltered: boolean;
  onClearFilters: () => void;
}) {
  return isFiltered ? (
    <EmptyState
      icon={ListChecks}
      title="No obligations match these filters"
      description="Loosen a filter, or clear them all to see the whole register."
      action={
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs font-medium text-accent underline underline-offset-4"
        >
          Clear filters
        </button>
      }
    />
  ) : (
    <EmptyState
      icon={ListChecks}
      title="No obligations tracked yet"
      description={
        <>
          Obligations appear here once a contract has been analysed. Start on the{' '}
          <Link to="/contracts" className="text-accent underline underline-offset-4">
            contracts screen
          </Link>{' '}
          — upload a document, or load the CUAD sample.
        </>
      }
    />
  );
}

export default function ObligationTable({
  items,
  loading,
  error,
  onRetry,
  isFiltered,
  onClearFilters,
  sort,
  dir,
  onSort,
}: ObligationTableProps) {
  if (loading) return <SkeletonRows rows={8} height="h-14" label="Loading obligations" />;
  if (error) return <ErrorPanel error={error} what="the obligation register" onRetry={onRetry} />;
  if (items.length === 0) return <Empty isFiltered={isFiltered} onClearFilters={onClearFilters} />;

  const sortIcon = (key: SortKey | null): ReactNode => {
    if (!key || key !== sort) return null;
    const Icon = dir === 'asc' ? ArrowUp : ArrowDown;
    return <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />;
  };

  return (
    <>
      {/* ---------------------------------------------- narrow: stacked cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((obligation) => (
          <li key={obligation.id}>
            <Link
              to={`/obligations/${obligation.id}`}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 transition-colors duration-240 ease-instrument hover:border-[rgb(var(--accent-rgb)/0.4)]"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text">
                    {obligation.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {obligation.contract_title ?? 'Unknown contract'}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                <VerificationCell obligation={obligation} />
                <Badge tone={SEVERITY_META[obligation.severity].tone} size="xs">
                  {SEVERITY_META[obligation.severity].label}
                </Badge>
                <Badge tone="muted" size="xs">
                  {typeLabel(obligation.obligation_type)}
                </Badge>
                <Badge tone={STATUS_META[obligation.status].tone} size="xs">
                  {STATUS_META[obligation.status].label}
                </Badge>
              </span>

              <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="truncate">{truncate(obligation.claim, 90)}</span>
                <span className="shrink-0">
                  <DueCell obligation={obligation} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------- wide: dense table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  aria-sort={
                    column.key && column.key === sort
                      ? dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className={cn(
                    'px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted',
                    column.className,
                  )}
                >
                  {column.key ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key as SortKey)}
                      title="Sort the rows loaded on this page"
                      className="inline-flex items-center gap-1 uppercase tracking-[0.14em] transition-colors duration-240 ease-instrument hover:text-text"
                    >
                      {column.label}
                      {sortIcon(column.key)}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
              <th scope="col" className="w-8 px-3 py-2">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {items.map((obligation) => (
              <tr
                key={obligation.id}
                className="group border-b border-border transition-colors duration-240 ease-instrument last:border-0 hover:bg-surface"
              >
                <td className="max-w-0 px-3 py-2.5">
                  <TitleCell obligation={obligation} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone="muted" size="xs">
                    {typeLabel(obligation.obligation_type)}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SEVERITY_META[obligation.severity].color }}
                    />
                    <span className="text-xs text-text">
                      {SEVERITY_META[obligation.severity].label}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <VerificationCell obligation={obligation} />
                </td>
                <td className="px-3 py-2.5">
                  <DueCell obligation={obligation} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={STATUS_META[obligation.status].tone} size="xs">
                    {STATUS_META[obligation.status].label}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Link
                    to={`/obligations/${obligation.id}`}
                    aria-label={`Open ${obligation.title}`}
                    className="inline-flex text-muted transition-colors duration-240 ease-instrument group-hover:text-accent"
                  >
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

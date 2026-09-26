/**
 * The register as a month grid. Feeds off `getCalendar()` — a lighter payload
 * than the register (ObligationOut, no verification), so the verdict filter is
 * disabled in this mode and the rest are applied client-side.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { getCalendar } from '@/lib/api';

import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { ErrorPanel } from '@/components/obligations/PanelStates';
import type { ObligationFilterValues } from '@/components/obligations/ObligationFilters';
import {
  SEVERITIES,
  SEVERITY_META,
  isOverdue,
  toIsoDate,
} from '@/components/obligations/tokens';
import { cn, formatDate, severityRank } from '@/lib/format';
import type { ObligationOut } from '@/lib/types';

export interface ObligationCalendarProps {
  /** YYYY-MM */
  month: string;
  onMonthChange: (month: string) => void;
  filters: ObligationFilterValues;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function currentMonth(): string {
  return toIsoDate(new Date()).slice(0, 7);
}

/** Parses YYYY-MM, falling back to the current month for anything malformed. */
export function parseMonth(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const now = new Date();
  if (!match) return { year: now.getFullYear(), monthIndex: now.getMonth() };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }
  return { year, monthIndex };
}

function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonth(month);
  const shifted = new Date(year, monthIndex + delta, 1);
  return toIsoDate(shifted).slice(0, 7);
}

function matchesFilters(item: ObligationOut, filters: ObligationFilterValues): boolean {
  if (filters.status && item.status !== filters.status) return false;
  if (filters.type && item.obligation_type !== filters.type) return false;
  if (filters.severity && item.severity !== filters.severity) return false;
  if (filters.contractId && item.contract_id !== filters.contractId) return false;
  if (filters.dueBefore && item.due_date && item.due_date >= filters.dueBefore) return false;
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const haystack = `${item.title} ${item.claim} ${item.obligor ?? ''} ${item.obligee ?? ''}`;
    if (!haystack.toLowerCase().includes(needle)) return false;
  }
  return true;
}

function DayItem({ item }: { item: ObligationOut }) {
  const meta = SEVERITY_META[item.severity];
  const overdue = isOverdue(item.due_date, item.status);
  return (
    <Link
      to={`/obligations/${item.id}`}
      title={`${item.title} — ${meta.label}${overdue ? ' · overdue' : ''}`}
      className={cn(
        'flex items-center gap-1 rounded border-l-2 px-1.5 py-1 text-[11px] leading-tight text-text',
        'transition-colors duration-240 ease-instrument hover:bg-[rgb(var(--surface-rgb)/0.1)]',
        overdue && 'outline-dashed outline-1 outline-offset-[-1px]',
      )}
      style={{
        borderLeftColor: meta.color,
        backgroundColor: `rgb(${meta.rgb} / 0.1)`,
        outlineColor: overdue ? 'var(--ungrounded)' : undefined,
      }}
    >
      {overdue && (
        <AlertTriangle aria-hidden="true" className="h-2.5 w-2.5 shrink-0 text-ungrounded" />
      )}
      <span className="truncate">{item.title}</span>
    </Link>
  );
}

export default function ObligationCalendar({
  month,
  onMonthChange,
  filters,
}: ObligationCalendarProps) {
  const { year, monthIndex } = parseMonth(month);

  const range = useMemo(() => {
    const first = new Date(year, monthIndex, 1);
    const last = new Date(year, monthIndex + 1, 0);
    return { from: toIsoDate(first), to: toIsoDate(last), first, daysInMonth: last.getDate() };
  }, [year, monthIndex]);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['obligations', 'calendar', range.from, range.to],
    queryFn: () => getCalendar({ from: range.from, to: range.to }),
  });

  const byDate = useMemo(() => {
    const map = new Map<string, ObligationOut[]>();
    for (const day of data?.days ?? []) {
      // Defensive: only ever show days inside the month being rendered.
      if (day.date < range.from || day.date > range.to) continue;
      const kept = day.items
        .filter((item) => matchesFilters(item, filters))
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
      if (kept.length > 0) map.set(day.date, kept);
    }
    return map;
  }, [data, filters, range.from, range.to]);

  const leading = (range.first.getDay() + 6) % 7; // Monday-first grid
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: range.daysInMonth }, (_, i) =>
      toIsoDate(new Date(year, monthIndex, i + 1)),
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = toIsoDate(new Date());
  const monthLabel = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(range.first);
  const total = [...byDate.values()].reduce((sum, items) => sum + items.length, 0);
  const daysWithItems = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-3">
      {/* -------------------------------------------------------- month nav */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            iconLeft={<ChevronLeft aria-hidden="true" className="h-4 w-4" />}
          />
          <span className="min-w-[10ch] text-sm font-semibold text-text">{monthLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next month"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            iconLeft={<ChevronRight aria-hidden="true" className="h-4 w-4" />}
          />
          <Button variant="ghost" size="sm" onClick={() => onMonthChange(currentMonth())}>
            Today
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {SEVERITIES.map((severity) => (
            <span key={severity} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: SEVERITY_META[severity].color }}
              />
              {SEVERITY_META[severity].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11px] text-ungrounded">
            <AlertTriangle aria-hidden="true" className="h-3 w-3 shrink-0" />
            Overdue
          </span>
        </div>
      </div>

      {isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="grid grid-cols-1 gap-2 md:grid-cols-7"
        >
          <span className="sr-only">Loading the calendar</span>
          {Array.from({ length: 28 }, (_, i) => (
            <Skeleton key={i} className="h-16 md:h-24" rounded="lg" />
          ))}
        </div>
      ) : isError ? (
        <ErrorPanel error={error} what="the obligation calendar" onRetry={() => void refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={`Nothing due in ${monthLabel}`}
          description="Step to another month, or clear the filters — obligations without a due date never appear on the calendar."
        />
      ) : (
        <>
          {/* ------------------------------------------ narrow: agenda list */}
          <ul className="flex flex-col gap-2 md:hidden">
            {daysWithItems.map(([date, items]) => (
              <li key={date} className="rounded-xl border border-border bg-surface p-3">
                <p className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs tabular-nums text-text">
                    {formatDate(date, { weekday: 'short', day: '2-digit', month: 'short' })}
                  </span>
                  <span className="text-[11px] text-muted">
                    {items.length} due{date === today ? ' · today' : ''}
                  </span>
                </p>
                <div className="flex flex-col gap-1">
                  {items.map((item) => (
                    <DayItem key={item.id} item={item} />
                  ))}
                </div>
              </li>
            ))}
          </ul>

          {/* --------------------------------------------- wide: month grid */}
          <div className="hidden md:block">
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
              {WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className="bg-bg-elev px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
                >
                  {weekday}
                </div>
              ))}

              {cells.map((date, index) => {
                if (!date) {
                  return <div key={`pad-${index}`} className="min-h-[88px] bg-bg" aria-hidden="true" />;
                }
                const items = byDate.get(date) ?? [];
                const isToday = date === today;
                return (
                  <div
                    key={date}
                    className={cn(
                      'flex min-h-[88px] flex-col gap-1 bg-bg-elev p-1.5',
                      isToday && 'ring-1 ring-inset ring-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'font-mono text-[11px] tabular-nums',
                        isToday ? 'font-semibold text-accent' : 'text-muted',
                      )}
                    >
                      {date.slice(-2)}
                    </span>
                    <div className="flex max-h-[104px] flex-col gap-1 overflow-y-auto">
                      {items.map((item) => (
                        <DayItem key={item.id} item={item} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] text-muted">
            <span className="font-mono tabular-nums text-text">{total}</span> obligation
            {total === 1 ? '' : 's'} fall due in {monthLabel}. Verdict filtering is unavailable in
            calendar mode — the calendar feed carries no verification.
          </p>
        </>
      )}
    </div>
  );
}

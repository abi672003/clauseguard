/**
 * /review — the human-in-the-loop queue.
 *
 * Everything the agent refused to decide alone lands here with its full case
 * file. Approve / Reject writes through `POST /review/{id}/resolve` with an
 * optimistic update: the card leaves the queue immediately and comes back if
 * the API rejects the write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ClipboardCheck, Keyboard } from 'lucide-react';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ReviewCard from '@/components/review/ReviewCard';
import ReviewStatsHeader from '@/components/review/ReviewStatsHeader';
import { ErrorPanel, SkeletonRows } from '@/components/obligations/PanelStates';
import { REVIEW_STATES, REVIEW_STATE_META, asEnum } from '@/components/obligations/tokens';
import { getReviewQueue, getReviewStats, resolveReview } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import type { Paginated, ReviewDecision, ReviewStats, ReviewState, ReviewTaskOut } from '@/lib/types';

const LIMIT = 25;

interface ResolveVars {
  taskId: string;
  decision: ReviewDecision;
  notes: string;
}

interface ResolveContext {
  queue: Paginated<ReviewTaskOut> | undefined;
  stats: ReviewStats | undefined;
}

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'j / k', action: 'move' },
  { keys: 'a', action: 'approve' },
  { keys: 'r', action: 'reject' },
  { keys: 'enter', action: 'expand' },
];

export default function Review() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();

  const state: ReviewState = asEnum(REVIEW_STATES, params.get('state')) ?? 'open';
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  const queueKey = useMemo(
    () => ['review', 'queue', { state, limit: LIMIT, offset }] as const,
    [state, offset],
  );
  const statsKey = ['review', 'stats'] as const;

  const queue = useQuery({
    queryKey: queueKey,
    queryFn: () => getReviewQueue({ state, limit: LIMIT, offset }),
  });

  const stats = useQuery({
    queryKey: statsKey,
    queryFn: getReviewStats,
  });

  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const total = queue.data?.total ?? 0;

  /* ------------------------------------------------------- local ui state */
  const [selected, setSelected] = useState(0);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const scrollPending = useRef(false);
  const seeded = useRef(false);

  // Keep the cursor inside the list as it shrinks under optimistic removals.
  useEffect(() => {
    setSelected((index) => (items.length === 0 ? 0 : Math.min(index, items.length - 1)));
  }, [items.length]);

  // Open the first case file on arrival — a queue of closed rows tells nobody anything.
  useEffect(() => {
    if (seeded.current || items.length === 0) return;
    seeded.current = true;
    setExpandedIds([items[0].id]);
  }, [items]);

  useEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const task = items[selected];
    if (!task) return;
    cardRefs.current.get(task.id)?.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [selected, items, reducedMotion]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }, []);

  /* ------------------------------------------------ optimistic resolution */
  const resolve = useMutation<ReviewTaskOut, Error, ResolveVars, ResolveContext>({
    mutationFn: ({ taskId, decision, notes: body }) =>
      resolveReview(taskId, { decision, notes: body.trim() === '' ? null : body.trim() }),

    onMutate: async ({ taskId, decision }) => {
      await queryClient.cancelQueries({ queryKey: queueKey });
      await queryClient.cancelQueries({ queryKey: statsKey });

      const previousQueue = queryClient.getQueryData<Paginated<ReviewTaskOut>>(queueKey);
      const previousStats = queryClient.getQueryData<ReviewStats>(statsKey);
      const nextState: ReviewState = decision === 'approve' ? 'approved' : 'rejected';

      if (previousQueue) {
        const stillBelongs = state !== 'open';
        queryClient.setQueryData<Paginated<ReviewTaskOut>>(queueKey, {
          total: Math.max(0, previousQueue.total - (stillBelongs ? 0 : 1)),
          items: stillBelongs
            ? previousQueue.items.map((task) =>
                task.id === taskId ? { ...task, state: nextState } : task,
              )
            : previousQueue.items.filter((task) => task.id !== taskId),
        });
      }

      if (previousStats && state === 'open') {
        queryClient.setQueryData<ReviewStats>(statsKey, {
          ...previousStats,
          open: Math.max(0, previousStats.open - 1),
          approved: previousStats.approved + (decision === 'approve' ? 1 : 0),
          rejected: previousStats.rejected + (decision === 'reject' ? 1 : 0),
        });
      }

      return { queue: previousQueue, stats: previousStats };
    },

    onError: (_error, _vars, context) => {
      // Roll back to exactly what the server last told us.
      if (context?.queue) queryClient.setQueryData(queueKey, context.queue);
      if (context?.stats) queryClient.setQueryData(statsKey, context.stats);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['obligations'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const handleResolve = useCallback(
    (task: ReviewTaskOut, decision: ReviewDecision) => {
      if (task.state !== 'open' || resolve.isPending) return;
      resolve.mutate({ taskId: task.id, decision, notes: notes[task.id] ?? '' });
    },
    [notes, resolve],
  );

  /* ------------------------------------------------------------ shortcuts */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (items.length === 0) return;

      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        event.preventDefault();
        scrollPending.current = true;
        setSelected((index) =>
          Math.min(items.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1))),
        );
        return;
      }

      const task = items[selected];
      if (!task) return;

      if (key === 'a' || key === 'r') {
        event.preventDefault();
        handleResolve(task, key === 'a' ? 'approve' : 'reject');
      } else if (key === 'enter') {
        event.preventDefault();
        toggleExpanded(task.id);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, selected, handleResolve, toggleExpanded]);

  /* ----------------------------------------------------------------- view */
  const setState = (next: ReviewState) => {
    setParams(
      (prev) => {
        const search = new URLSearchParams(prev);
        if (next === 'open') search.delete('state');
        else search.set('state', next);
        search.delete('offset');
        return search;
      },
      { replace: true },
    );
  };

  const setOffset = (next: number) => {
    setParams(
      (prev) => {
        const search = new URLSearchParams(prev);
        if (next <= 0) search.delete('offset');
        else search.set('offset', String(next));
        return search;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-text">Review queue</h1>
          <p className="mt-0.5 text-xs text-muted">
            Claims the agent refused to track on its own authority. Each card carries the clause,
            the claim and the evidence behind the escalation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-muted sm:flex">
            <Keyboard aria-hidden="true" className="h-3.5 w-3.5" />
            {SHORTCUTS.map(({ keys, action }) => (
              <span key={keys} className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-surface px-1 font-mono">{keys}</kbd>
                {action}
              </span>
            ))}
          </span>

          <div
            role="group"
            aria-label="Filter by state"
            className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1"
          >
            {REVIEW_STATES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={state === value}
                onClick={() => setState(value)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs transition-colors duration-240 ease-instrument',
                  state === value
                    ? 'bg-[rgb(var(--accent-rgb)/0.16)] text-accent'
                    : 'text-muted hover:text-text',
                )}
              >
                {REVIEW_STATE_META[value].label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <ReviewStatsHeader
        stats={stats.data}
        loading={stats.isPending}
        error={stats.isError ? stats.error : null}
        onRetry={() => void stats.refetch()}
      />

      <Card
        title={`${REVIEW_STATE_META[state].label} tasks`}
        subtitle={
          queue.isPending
            ? 'Loading the queue…'
            : queue.isError
              ? 'Queue unavailable'
              : `${formatNumber(total)} task${total === 1 ? '' : 's'}${
                  queue.isFetching ? ' · refreshing' : ''
                }`
        }
        padded={false}
        bodyClassName="p-3 sm:p-4"
        footer={
          total > LIMIT ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs tabular-nums text-muted">
                {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + items.length, total))} /{' '}
                {formatNumber(total)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  aria-label="Previous page"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  iconLeft={<ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />}
                />
                <Button
                  size="sm"
                  aria-label="Next page"
                  disabled={offset + LIMIT >= total}
                  onClick={() => setOffset(offset + LIMIT)}
                  iconLeft={<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />}
                />
              </div>
            </div>
          ) : undefined
        }
      >
        {queue.isPending ? (
          <SkeletonRows rows={4} height="h-40" label="Loading the review queue" />
        ) : queue.isError ? (
          <ErrorPanel
            error={queue.error}
            what="the review queue"
            onRetry={() => void queue.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={
              state === 'open'
                ? 'Nothing waiting on a human'
                : `No ${REVIEW_STATE_META[state].label.toLowerCase()} tasks`
            }
            description={
              state === 'open'
                ? 'Every escalation has been resolved. New ones appear here the moment the agent declines to auto-track a claim.'
                : 'Switch back to the open queue, or resolve a task to populate this list.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((task, index) => (
              <ReviewCard
                key={task.id}
                task={task}
                selected={index === selected}
                expanded={expandedIds.includes(task.id)}
                notes={notes[task.id] ?? ''}
                pending={
                  resolve.isPending && resolve.variables?.taskId === task.id
                    ? resolve.variables.decision
                    : null
                }
                error={
                  resolve.isError && resolve.variables?.taskId === task.id ? resolve.error : null
                }
                onSelect={() => setSelected(index)}
                onToggle={() => toggleExpanded(task.id)}
                onNotesChange={(value) =>
                  setNotes((current) => ({ ...current, [task.id]: value }))
                }
                onResolve={(decision) => handleResolve(task, decision)}
                innerRef={(element) => {
                  if (element) cardRefs.current.set(task.id, element);
                  else cardRefs.current.delete(task.id);
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

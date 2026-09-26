import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronUp, FileWarning } from 'lucide-react';

import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import {
  attrSelector,
  buildDocument,
  clauseVerdictMap,
  obligationsByClause,
  type TextBlock,
} from '@/components/contracts/helpers';
import { cn, formatNumber, verdictColorVar, verdictRgbVar } from '@/lib/format';
import type { ClauseOut, ObligationDetail, Verdict } from '@/lib/types';

/** Contracts longer than this are windowed rather than rendered whole. */
const WINDOW_THRESHOLD = 200_000;
const BLOCK_CHARS = 20_000;
const INITIAL_BLOCKS = 3;
const EDGE_PX = 600;

function segmentStyle(verdict: Verdict | null, isCandidate: boolean): CSSProperties {
  if (verdict) {
    return {
      backgroundColor: `rgb(${verdictRgbVar(verdict)} / 0.16)`,
      boxShadow: `inset 0 -1px 0 0 ${verdictColorVar(verdict)}`,
      color: 'inherit',
    };
  }
  if (isCandidate) {
    return {
      backgroundColor: 'rgb(var(--accent-rgb) / 0.09)',
      boxShadow: 'inset 0 -1px 0 0 rgb(var(--accent-rgb) / 0.45)',
      color: 'inherit',
    };
  }
  return { backgroundColor: 'transparent', color: 'inherit' };
}

const SELECTED_STYLE: CSSProperties = {
  outline: '1px solid var(--accent)',
  outlineOffset: '2px',
  borderRadius: '3px',
  boxShadow: '0 0 0 6px rgb(var(--accent-rgb) / 0.16)',
};

interface BlockProps {
  block: TextBlock;
  selectedClauseId: string | null;
  onSelectClause: (clauseId: string) => void;
}

const Block = memo(function Block({ block, selectedClauseId, onSelectClause }: BlockProps) {
  return (
    <div data-block={block.index}>
      {block.segments.map((segment) => {
        if (!segment.clause) {
          return <span key={segment.key}>{segment.text}</span>;
        }
        const { clause } = segment;
        const selected = selectedClauseId === clause.id;
        const interactive = segment.obligationCount > 0 || clause.is_candidate;
        return (
          <mark
            key={segment.key}
            data-clause-id={clause.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : -1}
            aria-pressed={interactive ? selected : undefined}
            title={[
              `Clause ${clause.index}`,
              clause.category ? `category ${clause.category}` : null,
              clause.is_candidate ? 'candidate' : null,
              segment.obligationCount > 0
                ? `${segment.obligationCount} obligation${segment.obligationCount === 1 ? '' : 's'}`
                : null,
              segment.verdict ? `verdict ${segment.verdict}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            onClick={() => onSelectClause(clause.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectClause(clause.id);
              }
            }}
            className={cn(
              'cursor-pointer transition-[background-color,box-shadow] duration-240 ease-instrument',
              'hover:bg-[rgb(var(--surface-rgb)/0.1)] focus-visible:outline-none',
            )}
            style={{
              ...segmentStyle(segment.verdict, clause.is_candidate),
              ...(selected ? SELECTED_STYLE : {}),
            }}
          >
            {segment.text}
          </mark>
        );
      })}
    </div>
  );
});

export interface ClauseTextPaneProps {
  rawText: string;
  clauses: readonly ClauseOut[];
  obligations: readonly ObligationDetail[];
  selectedClauseId: string | null;
  onSelectClause: (clauseId: string) => void;
  className?: string;
}

/**
 * The contract, verbatim, with every clause span marked against `raw_text`
 * using `char_start`/`char_end`. Candidate clauses are tinted by the verdict of
 * any obligation drawn from them. Very long documents are windowed by block so
 * the page stays responsive.
 */
export default function ClauseTextPane({
  rawText,
  clauses,
  obligations,
  selectedClauseId,
  onSelectClause,
  className,
}: ClauseTextPaneProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const restoreHeight = useRef<number | null>(null);

  const document_ = useMemo(() => {
    const verdicts = clauseVerdictMap(obligations);
    const counts = obligationsByClause(obligations);
    return buildDocument(rawText, clauses, verdicts, counts, BLOCK_CHARS);
  }, [rawText, clauses, obligations]);

  const { blocks, clauseBlock } = document_;
  const windowed = rawText.length > WINDOW_THRESHOLD && blocks.length > INITIAL_BLOCKS;
  const lastBlock = Math.max(0, blocks.length - 1);

  const [range, setRange] = useState(() => ({
    from: 0,
    to: Math.min(lastBlock, INITIAL_BLOCKS - 1),
  }));

  // A different contract (or a re-analysis that changed the segmentation)
  // resets the window. Keyed on shape, not identity, so polling cannot yank
  // the reader back to the top every three seconds.
  const blockCount = blocks.length;
  useEffect(() => {
    setRange({ from: 0, to: Math.min(Math.max(0, blockCount - 1), INITIAL_BLOCKS - 1) });
  }, [rawText, blockCount]);

  const extendUp = useCallback(() => {
    const element = scrollRef.current;
    if (element) restoreHeight.current = element.scrollHeight;
    setRange((previous) => (previous.from === 0 ? previous : { ...previous, from: previous.from - 1 }));
  }, []);

  const extendDown = useCallback(() => {
    setRange((previous) =>
      previous.to >= lastBlock ? previous : { ...previous, to: previous.to + 1 },
    );
  }, [lastBlock]);

  // Prepending a block must not yank the reader up the page.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previousHeight = restoreHeight.current;
    if (element && previousHeight !== null) {
      element.scrollTop += element.scrollHeight - previousHeight;
      restoreHeight.current = null;
    }
  }, [range]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !windowed) return;
    if (element.scrollTop < EDGE_PX) extendUp();
    else if (element.scrollHeight - element.scrollTop - element.clientHeight < EDGE_PX) extendDown();
  }, [extendDown, extendUp, windowed]);

  // A changed selection arms one scroll. Extending the window by scrolling does
  // not re-arm it, so reading on past a highlighted clause never snaps back.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  useEffect(() => {
    setScrollTarget(selectedClauseId);
  }, [selectedClauseId]);

  // Selecting an obligation scrolls its source clause into view — expanding the
  // rendered window first when the clause lives outside it.
  useEffect(() => {
    if (!scrollTarget) return;
    const element = scrollRef.current;
    if (!element) return;

    const blockIndex = clauseBlock.get(scrollTarget);
    if (blockIndex === undefined) {
      setScrollTarget(null);
      return;
    }

    if (windowed && (blockIndex < range.from || blockIndex > range.to)) {
      restoreHeight.current = null;
      setRange({
        from: Math.max(0, blockIndex - 1),
        to: Math.min(lastBlock, blockIndex + 1),
      });
      return; // re-runs once the wider window has rendered
    }

    const target = element.querySelector<HTMLElement>(
      attrSelector('data-clause-id', scrollTarget),
    );
    if (target) {
      const top = target.offsetTop - element.clientHeight / 2 + target.offsetHeight / 2;
      element.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    setScrollTarget(null);
  }, [clauseBlock, lastBlock, range.from, range.to, reducedMotion, scrollTarget, windowed]);

  const visible = windowed ? blocks.slice(range.from, range.to + 1) : blocks;
  const candidates = clauses.filter((clause) => clause.is_candidate).length;

  if (rawText.length === 0) {
    return (
      <div className={cn('p-4 sm:p-5', className)}>
        <EmptyState
          icon={FileWarning}
          title="No contract text stored"
          description="The ingest step did not persist any text for this contract — re-upload the file or re-run the analysis."
        />
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-2 text-[11px] text-muted">
        <span className="font-mono tabular-nums">
          {formatNumber(clauses.length)} clauses · {formatNumber(candidates)} candidates ·{' '}
          {formatNumber(rawText.length)} chars
        </span>
        {(['grounded', 'uncertain', 'ungrounded'] as const).map((verdict) => (
          <span key={verdict} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-3 rounded-sm"
              style={{
                backgroundColor: `rgb(${verdictRgbVar(verdict)} / 0.3)`,
                boxShadow: `inset 0 -1px 0 0 ${verdictColorVar(verdict)}`,
              }}
            />
            {verdict}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-3 rounded-sm"
            style={{
              backgroundColor: 'rgb(var(--accent-rgb) / 0.18)',
              boxShadow: 'inset 0 -1px 0 0 rgb(var(--accent-rgb) / 0.45)',
            }}
          />
          candidate
        </span>
      </div>

      {windowed && range.from > 0 && (
        <div className="border-b border-border px-4 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={extendUp}
            iconLeft={<ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />}
          >
            Load earlier text
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Contract text with clause spans highlighted"
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 font-mono text-[12px] leading-[1.75] text-text [overflow-wrap:anywhere] [white-space:pre-wrap] sm:px-5"
      >
        {visible.map((block) => (
          <Block
            key={block.index}
            block={block}
            selectedClauseId={selectedClauseId}
            onSelectClause={onSelectClause}
          />
        ))}
      </div>

      {windowed && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-1.5">
          <span className="font-mono text-[11px] tabular-nums text-muted">
            block {range.from + 1}–{range.to + 1} of {blocks.length}
          </span>
          {range.to < lastBlock && (
            <Button
              variant="ghost"
              size="sm"
              onClick={extendDown}
              iconRight={<ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

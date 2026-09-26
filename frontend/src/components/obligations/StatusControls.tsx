/**
 * The end of the chain: a human setting the tracked status. Every change is a
 * `PATCH /obligations/{id}/status` call — nothing is changed locally only.
 */
import { AlertTriangle, Check } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { describeError } from '@/components/obligations/PanelStates';
import { OBLIGATION_STATUSES, STATUS_META } from '@/components/obligations/tokens';
import type { ObligationStatus } from '@/lib/types';

export interface StatusControlsProps {
  current: ObligationStatus;
  onSelect: (status: ObligationStatus) => void;
  /** The status currently being written, if any. */
  pendingStatus: ObligationStatus | null;
  error: unknown;
  disabled?: boolean;
}

export default function StatusControls({
  current,
  onSelect,
  pendingStatus,
  error,
  disabled = false,
}: StatusControlsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Current</span>
        <Badge tone={STATUS_META[current].tone}>{STATUS_META[current].label}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {OBLIGATION_STATUSES.map((status) => {
          const isCurrent = status === current;
          const meta = STATUS_META[status];
          return (
            <Button
              key={status}
              size="sm"
              variant={
                isCurrent ? 'primary' : status === 'rejected' ? 'danger' : 'secondary'
              }
              aria-pressed={isCurrent}
              disabled={disabled || isCurrent || pendingStatus !== null}
              loading={pendingStatus === status}
              onClick={() => onSelect(status)}
              iconLeft={
                isCurrent ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : undefined
              }
            >
              {meta.label}
            </Button>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.08)] p-2.5 text-xs text-ungrounded"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Status not saved — {describeError(error)}
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          Approving or rejecting here resolves the obligation itself. Escalated items also carry a
          task in the{' '}
          <span className="text-text">review queue</span>, where the decision is recorded with notes.
        </p>
      )}
    </div>
  );
}

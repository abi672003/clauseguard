/**
 * The queue's vital signs, straight from `GET /review/stats`.
 * Mean age is the number that matters: it says whether the human loop is
 * keeping up with the pipeline.
 */
import { CheckCircle2, Clock, Inbox, XCircle } from 'lucide-react';

import StatTile from '@/components/ui/StatTile';
import { ErrorPanel } from '@/components/obligations/PanelStates';
import { formatNumber } from '@/lib/format';
import type { ReviewStats } from '@/lib/types';

export interface ReviewStatsHeaderProps {
  stats: ReviewStats | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

function formatAge(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0h';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export default function ReviewStatsHeader({
  stats,
  loading,
  error,
  onRetry,
}: ReviewStatsHeaderProps) {
  if (error) {
    return <ErrorPanel error={error} what="the queue statistics" onRetry={onRetry} />;
  }

  const settled = stats ? stats.approved + stats.rejected : 0;
  const approvalRate = settled > 0 && stats ? stats.approved / settled : null;

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatTile
        label="Open"
        loading={loading}
        tone={stats && stats.open > 0 ? 'uncertain' : 'grounded'}
        icon={Inbox}
        value={formatNumber(stats?.open ?? 0)}
        hint="Escalations waiting on a human"
      />
      <StatTile
        label="Approved"
        loading={loading}
        tone="grounded"
        icon={CheckCircle2}
        value={formatNumber(stats?.approved ?? 0)}
        hint={
          approvalRate === null
            ? 'Nothing resolved yet'
            : `${(approvalRate * 100).toFixed(0)}% of resolved tasks`
        }
      />
      <StatTile
        label="Rejected"
        loading={loading}
        tone="ungrounded"
        icon={XCircle}
        value={formatNumber(stats?.rejected ?? 0)}
        hint="Claims the reviewer threw out"
      />
      <StatTile
        label="Mean age"
        loading={loading}
        tone={stats && stats.mean_age_hours > 48 ? 'ungrounded' : 'accent'}
        icon={Clock}
        value={formatAge(stats?.mean_age_hours ?? 0)}
        hint="How long an open task has been waiting"
      />
    </div>
  );
}

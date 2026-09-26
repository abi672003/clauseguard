import {
  AlarmClock,
  CalendarClock,
  FileText,
  Gauge,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
} from 'lucide-react';

import StatTile from '@/components/ui/StatTile';
import { formatNumber, formatPct } from '@/lib/format';
import type { DashboardStats } from '@/lib/types';

export interface KpiRowProps {
  stats?: DashboardStats;
  loading?: boolean;
}

/**
 * The headline numbers. Every one of them comes from `/analytics/dashboard`;
 * while the query is in flight each tile holds its own skeleton so the grid
 * never jumps.
 */
export default function KpiRow({ stats, loading = false }: KpiRowProps) {
  const pending = loading || !stats;

  const verified = stats ? stats.grounded + stats.ungrounded + stats.uncertain : 0;
  const groundedShare = verified > 0 && stats ? stats.grounded / verified : null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Contracts"
        icon={FileText}
        loading={pending}
        value={formatNumber(stats?.contracts)}
        hint={stats ? `${formatNumber(stats.contracts_processed)} analysed` : undefined}
      />

      <StatTile
        label="Obligations"
        icon={ListChecks}
        loading={pending}
        value={formatNumber(stats?.obligations)}
        hint={
          stats
            ? `from ${formatNumber(stats.candidate_clauses)} candidate clauses`
            : undefined
        }
      />

      <StatTile
        label="Auto-tracked"
        icon={UserCheck}
        tone="grounded"
        loading={pending}
        value={formatNumber(stats?.auto_tracked)}
        hint={
          stats && stats.obligations > 0
            ? `${formatPct(stats.auto_tracked / stats.obligations, 0)} of the register`
            : 'cleared verification unaided'
        }
      />

      <StatTile
        label="Pending review"
        icon={SlidersHorizontal}
        tone="uncertain"
        loading={pending}
        value={formatNumber(stats?.pending_review)}
        hint={stats ? `${formatNumber(stats.rejected)} rejected outright` : undefined}
      />

      <StatTile
        label="Grounded / ungrounded"
        icon={ShieldCheck}
        loading={pending}
        value={
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-grounded">{formatNumber(stats?.grounded)}</span>
            <span className="text-muted">/</span>
            <span className="text-ungrounded">{formatNumber(stats?.ungrounded)}</span>
          </span>
        }
        hint={
          groundedShare === null
            ? 'no verified claims yet'
            : `${formatPct(groundedShare, 0)} entailed by their clause`
        }
      />

      <StatTile
        label="Mean entailment"
        icon={Gauge}
        tone="accent"
        loading={pending}
        value={formatPct(stats?.mean_entailment)}
        hint={
          stats ? `${formatPct(stats.hallucination_rate_blocked)} blocked by the verifier` : undefined
        }
      />

      <StatTile
        label="Due in 30 days"
        icon={CalendarClock}
        loading={pending}
        value={formatNumber(stats?.upcoming_30d)}
        hint="dated obligations falling due this month"
      />

      <StatTile
        label="Overdue"
        icon={AlarmClock}
        tone={stats && stats.overdue > 0 ? 'ungrounded' : 'neutral'}
        loading={pending}
        value={formatNumber(stats?.overdue)}
        hint={stats && stats.overdue > 0 ? 'past their due date, still open' : 'nothing past due'}
      />
    </div>
  );
}

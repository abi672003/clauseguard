import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, RotateCcw } from 'lucide-react';

import ColdStart from '@/components/dashboard/ColdStart';
import ConstellationPanel from '@/components/dashboard/ConstellationPanel';
import EscalationsPanel from '@/components/dashboard/EscalationsPanel';
import KpiRow from '@/components/dashboard/KpiRow';
import MonthlyTrend from '@/components/dashboard/MonthlyTrend';
import TypeBreakdown from '@/components/dashboard/TypeBreakdown';
import VerdictDonut from '@/components/dashboard/VerdictDonut';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { getDashboard } from '@/lib/api';
import { formatNumber } from '@/lib/format';

function Header({ subtitle }: { subtitle: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-lg font-semibold tracking-tight text-text">Dashboard</h1>
      <p className="text-xs text-muted">{subtitle}</p>
    </header>
  );
}

export default function Dashboard() {
  const stats = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: getDashboard,
  });

  /* --------------------------------------------------------------- loading */
  if (stats.isPending) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Header subtitle="Reading portfolio posture from the API…" />
        <KpiRow loading />
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="grid grid-cols-1 gap-3 lg:grid-cols-3"
        >
          <span className="sr-only">Loading the dashboard</span>
          <Skeleton className="h-[340px] sm:h-[420px] lg:col-span-2" rounded="lg" />
          <Skeleton className="h-[340px] sm:h-[420px]" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- error */
  if (stats.isError) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Header subtitle="Portfolio-wide obligation posture" />
        <Card title="Dashboard unavailable">
          <EmptyState
            tone="error"
            icon={AlertOctagon}
            title={
              stats.error instanceof Error
                ? stats.error.message
                : 'The analytics endpoint did not answer'
            }
            description="Nothing on this screen is cached or synthesised — every figure is read from /analytics/dashboard, so there is nothing to show until it responds."
            action={
              <Button
                variant="primary"
                loading={stats.isFetching}
                onClick={() => void stats.refetch()}
                iconLeft={<RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
              >
                Retry
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const data = stats.data;

  /* ------------------------------------------------------------ cold start */
  if (data.contracts === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Header subtitle="Portfolio-wide obligation posture" />
        <KpiRow stats={data} />
        <ColdStart />
      </div>
    );
  }

  /* ----------------------------------------------------------------- ready */
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Header
        subtitle={`${formatNumber(data.contracts_processed)} of ${formatNumber(
          data.contracts,
        )} contracts analysed · ${formatNumber(data.clauses)} clauses segmented`}
      />

      <div className="animate-rise">
        <KpiRow stats={data} />
      </div>

      <div className="animate-rise grid grid-cols-1 gap-3 lg:grid-cols-3" style={{ animationDelay: '40ms' }}>
        <div className="min-w-0 lg:col-span-2">
          <ConstellationPanel />
        </div>
        <div className="min-w-0">
          <VerdictDonut stats={data} />
        </div>
      </div>

      <div className="animate-rise grid grid-cols-1 gap-3 lg:grid-cols-3" style={{ animationDelay: '80ms' }}>
        <div className="min-w-0">
          <TypeBreakdown stats={data} />
        </div>
        <div className="min-w-0">
          <MonthlyTrend stats={data} />
        </div>
        <div className="min-w-0">
          <EscalationsPanel />
        </div>
      </div>
    </div>
  );
}

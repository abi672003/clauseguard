import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, TriangleAlert } from 'lucide-react';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import ClauseTextPane from '@/components/contracts/ClauseTextPane';
import ContractHeader from '@/components/contracts/ContractHeader';
import ObligationList from '@/components/contracts/ObligationList';
import PipelineStream from '@/components/contracts/PipelineStream';
import RunHistory from '@/components/contracts/RunHistory';
import { isInFlight, obligationsByClause } from '@/components/contracts/helpers';
import { analyzeContract, ApiError, getContract, getContractRuns } from '@/lib/api';
import type { ObligationDetail } from '@/lib/types';

const POLL_MS = 3_000;
/** Both panes share one height so the split view reads as a single instrument. */
const PANE_HEIGHT = 'h-[62vh] min-h-[360px] lg:min-h-[420px]';

interface Selection {
  clauseId: string | null;
  obligationId: string | null;
}

export default function ContractDetail() {
  const { id } = useParams<{ id: string }>();
  const contractId = id ?? '';
  const queryClient = useQueryClient();

  const [selection, setSelection] = useState<Selection>({ clauseId: null, obligationId: null });
  const [verifierEnabled, setVerifierEnabled] = useState(true);
  const verifierSynced = useRef(false);

  const contract = useQuery({
    queryKey: ['contract', contractId],
    queryFn: () => getContract(contractId),
    enabled: contractId.length > 0,
    refetchInterval: (query) =>
      query.state.data && isInFlight(query.state.data.status) ? POLL_MS : false,
  });

  const detail = contract.data;
  const inFlight = detail ? isInFlight(detail.status) : false;

  const runs = useQuery({
    queryKey: ['contract-runs', contractId],
    queryFn: () => getContractRuns(contractId),
    enabled: contractId.length > 0,
    refetchInterval: inFlight ? POLL_MS : false,
  });

  /* The toggle starts wherever the last run left it, then the user owns it. */
  useEffect(() => {
    if (verifierSynced.current) return;
    const latest = detail?.latest_run;
    if (!latest) return;
    verifierSynced.current = true;
    setVerifierEnabled(latest.verifier_enabled);
  }, [detail?.latest_run]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
    void queryClient.invalidateQueries({ queryKey: ['contract-runs', contractId] });
    void queryClient.invalidateQueries({ queryKey: ['contracts'] });
  }, [contractId, queryClient]);

  const analysis = useMutation({
    mutationFn: () => analyzeContract(contractId, { verifier_enabled: verifierEnabled }),
    onSuccess: refresh,
  });

  const byClause = useMemo(
    () => obligationsByClause(detail?.obligations ?? []),
    [detail?.obligations],
  );

  const selectClause = useCallback(
    (clauseId: string) => {
      const drawn = byClause.get(clauseId);
      setSelection({ clauseId, obligationId: drawn?.[0]?.id ?? null });
    },
    [byClause],
  );

  const selectObligation = useCallback((obligation: ObligationDetail) => {
    setSelection({ clauseId: obligation.clause_id, obligationId: obligation.id });
  }, []);

  /* ------------------------------------------------------------- states */
  if (!contractId) {
    return (
      <Card title="Contract">
        <EmptyState
          tone="error"
          icon={TriangleAlert}
          title="No contract id in the URL"
          description="Open a contract from the register."
          action={
            <Link
              to="/contracts"
              className="text-xs font-medium text-accent underline underline-offset-4"
            >
              Back to contracts
            </Link>
          }
        />
      </Card>
    );
  }

  if (contract.isPending) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true">
        <span className="sr-only">Loading contract</span>
        <Card>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-72 max-w-full" />
            <Skeleton className="h-3 w-48" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-9" />
              ))}
            </div>
          </div>
        </Card>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
          <Skeleton className={PANE_HEIGHT} rounded="lg" />
          <Skeleton className={PANE_HEIGHT} rounded="lg" />
        </div>
      </div>
    );
  }

  if (contract.isError || !detail) {
    const notFound = contract.error instanceof ApiError && contract.error.status === 404;
    return (
      <Card title="Contract">
        <EmptyState
          tone="error"
          icon={notFound ? FileSearch : TriangleAlert}
          title={notFound ? 'No such contract' : 'Could not load this contract'}
          description={
            contract.error instanceof ApiError
              ? contract.error.message
              : 'The contract endpoint did not respond.'
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void contract.refetch()}>
                Try again
              </Button>
              <Link
                to="/contracts"
                className="text-xs font-medium text-accent underline underline-offset-4"
              >
                Back to contracts
              </Link>
            </div>
          }
        />
      </Card>
    );
  }

  /* -------------------------------------------------------------- screen */
  return (
    <div className="flex min-w-0 flex-col gap-3 animate-rise sm:gap-4">
      <Card>
        <ContractHeader
          contract={detail}
          verifierEnabled={verifierEnabled}
          onVerifierChange={setVerifierEnabled}
          onReanalyze={() => analysis.mutate()}
          analyzing={analysis.isPending}
          analyzeError={analysis.error}
        />
      </Card>

      {inFlight && (
        <Card
          title="Live analysis"
          subtitle="Streamed from the pipeline socket, stage by stage"
        >
          <PipelineStream contractId={detail.id} onFinished={refresh} />
        </Card>
      )}

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <Card
          padded={false}
          title="Contract text"
          subtitle="Clause spans marked against raw_text, tinted by verdict"
          bodyClassName="flex min-h-0 flex-col"
          className={PANE_HEIGHT}
        >
          <ClauseTextPane
            rawText={detail.raw_text}
            clauses={detail.clauses}
            obligations={detail.obligations}
            selectedClauseId={selection.clauseId}
            onSelectClause={selectClause}
            className="min-h-0 flex-1"
          />
        </Card>

        <Card
          padded={false}
          title="Obligations"
          subtitle={`${detail.obligations.length} drawn from this contract`}
          bodyClassName="flex min-h-0 flex-col"
          className={PANE_HEIGHT}
        >
          <ObligationList
            obligations={detail.obligations}
            selectedObligationId={selection.obligationId}
            selectedClauseId={selection.clauseId}
            onSelect={selectObligation}
            contractStatus={detail.status}
            className="min-h-0 flex-1"
          />
        </Card>
      </div>

      <Card
        padded={false}
        title="Run history"
        subtitle="Every pass of the pipeline over this contract, with stage timings"
      >
        <RunHistory
          runs={runs.data ?? []}
          loading={runs.isPending}
          error={runs.isError ? runs.error : undefined}
          onRetry={() => void runs.refetch()}
        />
      </Card>
    </div>
  );
}

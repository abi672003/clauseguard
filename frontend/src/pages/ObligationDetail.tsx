/**
 * /obligations/:id — the money screen.
 *
 * Read top to bottom it is a derivation, not a dashboard:
 *   source clause (premise)  ->  machine claim (hypothesis)
 *   ->  entailment evidence  ->  agent decision  ->  tracked status.
 * Every number on it is returned by `GET /obligations/{id}`.
 */
import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  ClipboardCheck,
  FileText,
  Quote,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import VerdictChip from '@/components/ui/VerdictChip';
import AgentPanel from '@/components/obligations/AgentPanel';
import ChainRail, { type ChainStep } from '@/components/obligations/ChainRail';
import ObligationFacts from '@/components/obligations/ObligationFacts';
import PremiseHypothesis from '@/components/obligations/PremiseHypothesis';
import StatusControls from '@/components/obligations/StatusControls';
import VerificationPanel from '@/components/obligations/VerificationPanel';
import { ErrorPanel } from '@/components/obligations/PanelStates';
import {
  ACTION_META,
  SEVERITY_META,
  STATUS_META,
  VERDICT_META,
  typeLabel,
} from '@/components/obligations/tokens';
import { getObligation, setObligationStatus } from '@/lib/api';
import { formatPct, formatRelativeDate } from '@/lib/format';
import type { ObligationDetail as ObligationDetailModel, ObligationStatus } from '@/lib/types';

function buildChain(obligation: ObligationDetailModel): ChainStep[] {
  const { clause, verification, decision } = obligation;

  const verdictMeta = verification ? VERDICT_META[verification.verdict] : null;
  const actionMeta = decision ? ACTION_META[decision.action] : null;

  return [
    {
      label: 'Source clause',
      value: clause?.category ?? (clause ? 'Uncategorised' : 'Missing'),
      detail: clause
        ? `Clause #${clause.index} · CUAD match ${formatPct(clause.category_score, 0)}`
        : 'No clause is linked to this obligation.',
      icon: Quote,
      color: clause ? 'var(--muted)' : 'var(--ungrounded)',
      href: '#premise',
    },
    {
      label: 'Machine claim',
      value: typeLabel(obligation.obligation_type),
      detail: `Extractor confidence ${formatPct(obligation.extraction_confidence, 0)}`,
      icon: ScanLine,
      color: 'var(--accent)',
      href: '#premise',
    },
    {
      label: 'Entailment',
      value: verification
        ? `${formatPct(verification.entailment, 0)} vs ${formatPct(verification.threshold_used, 0)}`
        : 'Not verified',
      detail: verification
        ? `${verdictMeta?.label ?? ''} · margin ${formatPct(verification.margin, 0)}`
        : 'The run had the verifier disabled.',
      icon: ShieldCheck,
      color: verdictMeta?.color ?? 'var(--muted)',
      href: '#verification',
    },
    {
      label: 'Agent decision',
      value: actionMeta?.label ?? 'None',
      detail: decision
        ? `${decision.policy_mode === 'llm' ? 'LLM policy' : 'Deterministic policy'} · confidence ${formatPct(decision.confidence, 0)}`
        : 'No decision was recorded.',
      icon: Bot,
      color: actionMeta?.color ?? 'var(--muted)',
      href: '#decision',
    },
    {
      label: 'Tracked status',
      value: STATUS_META[obligation.status].label,
      detail: obligation.due_date
        ? `Due ${formatRelativeDate(obligation.due_date)}`
        : 'No due date extracted.',
      icon: ClipboardCheck,
      color: STATUS_META[obligation.status].color,
      href: '#status',
    },
  ];
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the obligation</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-7 w-96 max-w-full" />
      <Skeleton className="h-20" rounded="lg" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-80" rounded="lg" />
        <Skeleton className="h-80" rounded="lg" />
      </div>
      <Skeleton className="h-56" rounded="lg" />
      <Skeleton className="h-56" rounded="lg" />
    </div>
  );
}

export default function ObligationDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['obligation', id],
    queryFn: () => getObligation(id as string),
    enabled: Boolean(id),
  });

  const mutation = useMutation({
    mutationFn: (status: ObligationStatus) => setObligationStatus(id as string, status),
    onSuccess: (updated) => {
      queryClient.setQueryData(['obligation', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['obligations'] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const handleStatus = useCallback(
    (status: ObligationStatus) => mutation.mutate(status),
    [mutation],
  );

  if (!id) {
    return (
      <Card title="Obligation">
        <EmptyState
          tone="error"
          title="No obligation id in the URL"
          description="Open an obligation from the register."
          action={
            <Link to="/obligations" className="text-xs text-accent underline underline-offset-4">
              Back to the register
            </Link>
          }
        />
      </Card>
    );
  }

  if (query.isPending) return <DetailSkeleton />;

  if (query.isError) {
    return (
      <Card title="Obligation">
        <ErrorPanel
          error={query.error}
          what="this obligation"
          onRetry={() => void query.refetch()}
        />
        <div className="mt-3">
          <Link to="/obligations" className="text-xs text-accent underline underline-offset-4">
            Back to the register
          </Link>
        </div>
      </Card>
    );
  }

  const obligation = query.data;
  const severity = SEVERITY_META[obligation.severity];
  const status = STATUS_META[obligation.status];

  return (
    <div className="flex flex-col gap-4 animate-rise">
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-col gap-3">
        <Link
          to="/obligations"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted transition-colors duration-240 ease-instrument hover:text-text"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Obligation register
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-text">{obligation.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <Link
                to={`/contracts/${obligation.contract_id}`}
                className="inline-flex items-center gap-1.5 text-accent underline-offset-4 hover:underline"
              >
                <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                {obligation.contract_title ?? 'Unknown contract'}
              </Link>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{obligation.id}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {obligation.verification && (
              <VerdictChip
                verdict={obligation.verification.verdict}
                score={obligation.verification.entailment}
              />
            )}
            <Badge tone={severity.tone}>{severity.label}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------- causal chain */}
      <ChainRail steps={buildChain(obligation)} />

      {/* ---------------------------------------------- premise vs hypothesis */}
      <div id="premise" className="scroll-mt-20">
        <PremiseHypothesis obligation={obligation} clause={obligation.clause} />
      </div>

      {/* -------------------------------------------------------- verification */}
      <Card
        className="scroll-mt-20"
        title="Verification — does the clause entail the claim?"
        subtitle="DeBERTa-v3 NLI over (premise, hypothesis), judged against the calibrated threshold"
      >
        <div id="verification">
          <VerificationPanel verification={obligation.verification} />
        </div>
      </Card>

      {/* ------------------------------------------------------------- agent */}
      <Card
        className="scroll-mt-20"
        title="Agent decision"
        subtitle="What the policy did with that evidence, and on whose authority"
      >
        <div id="decision">
          <AgentPanel decision={obligation.decision} />
        </div>
      </Card>

      {/* -------------------------------------------------------------- facts */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Trackable facts"
          subtitle="What a calendar, an alert or a finance system would consume"
        >
          <ObligationFacts obligation={obligation} />
        </Card>

        <Card
          className="scroll-mt-20"
          title="Status"
          subtitle="The end of the chain — a human's call"
        >
          <div id="status">
            <StatusControls
              current={obligation.status}
              onSelect={handleStatus}
              pendingStatus={mutation.isPending ? (mutation.variables ?? null) : null}
              error={mutation.isError ? mutation.error : null}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

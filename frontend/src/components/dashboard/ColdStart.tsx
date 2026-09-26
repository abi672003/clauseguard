import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DatabaseZap, TriangleAlert } from 'lucide-react';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import { seedContracts } from '@/lib/api';

/** The CUAD sample the brief calls for on an empty database. */
const SEED_LIMIT = 8;

/**
 * Cold start. There is nothing to visualise until the database has contracts,
 * so the dashboard offers the one action that fixes that and nothing else.
 */
export default function ColdStart() {
  const queryClient = useQueryClient();

  const seed = useMutation({
    mutationFn: () => seedContracts({ limit: SEED_LIMIT, analyze: true }),
    // Seeding rewrites the whole corpus — contracts, clauses, obligations,
    // verifications, the review queue and every analytic derived from them.
    onSuccess: () => queryClient.invalidateQueries(),
  });

  return (
    <Card title="No contracts loaded" subtitle="ClauseGuard has nothing to verify yet">
      <div className="flex flex-col gap-3">
        <EmptyState
          icon={DatabaseZap}
          title="Load the CUAD sample to see the verifier work"
          description={
            <>
              {SEED_LIMIT} real contracts from the CUAD corpus are ingested, segmented into clauses,
              mined for obligations and then checked claim-by-claim against their source clause.
              This takes a minute or two the first time, while the models warm up.
            </>
          }
          action={
            <Button
              variant="primary"
              loading={seed.isPending}
              onClick={() => seed.mutate()}
              iconLeft={<DatabaseZap aria-hidden="true" className="h-3.5 w-3.5" />}
            >
              {seed.isPending ? 'Seeding and analysing…' : `Load ${SEED_LIMIT} CUAD contracts`}
            </Button>
          }
        />

        {seed.isError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.1)] px-3 py-2 text-xs leading-relaxed text-ungrounded"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {seed.error instanceof Error
                ? seed.error.message
                : 'Seeding failed. Check that the backend is running.'}
            </span>
          </p>
        )}

        {seed.isSuccess && (
          <p role="status" className="text-xs text-muted">
            Seeded{' '}
            <span className="font-mono tabular-nums text-text">{seed.data.seeded.length}</span>{' '}
            contracts. The dashboard refreshes as the pipeline finishes each one.
          </p>
        )}
      </div>
    </Card>
  );
}

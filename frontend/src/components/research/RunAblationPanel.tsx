/**
 * Runs the ablation on demand.
 *
 * The run endpoint returns a 202 receipt immediately and the job continues in
 * the background for minutes, so this panel reports the server's own progress
 * rather than pretending the POST was the work.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical } from 'lucide-react';

import Button from '@/components/ui/Button';
import { describeError } from '@/components/obligations/PanelStates';
import { formatNumber } from '@/lib/format';

const MIN_SAMPLES = 20;
const MAX_SAMPLES = 2000;
const DEFAULT_SAMPLES = 200;

export interface RunAblationPanelProps {
  onRun: (nSamples: number) => void;
  /** True from submit until the server reports the job finished. */
  running: boolean;
  error: unknown;
  /** Server-reported completion, 0..1. */
  progress: number;
  /** Server-reported stage label. */
  stage: string;
  /** Set once a run has finished and its report is on screen. */
  finishedLabel: string | null;
}

export default function RunAblationPanel({
  onRun,
  running,
  error,
  progress,
  stage,
  finishedLabel,
}: RunAblationPanelProps) {
  const [samples, setSamples] = useState<number>(DEFAULT_SAMPLES);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return undefined;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const valid = Number.isFinite(samples) && samples >= MIN_SAMPLES && samples <= MAX_SAMPLES;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || running) return;
        onRun(Math.round(samples));
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <label
            htmlFor="ablation-samples"
            className="mb-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
          >
            Sample size
          </label>
          <input
            id="ablation-samples"
            type="number"
            inputMode="numeric"
            min={MIN_SAMPLES}
            max={MAX_SAMPLES}
            step={10}
            value={Number.isFinite(samples) ? samples : ''}
            disabled={running}
            onChange={(event) => setSamples(Number(event.target.value))}
            aria-describedby="ablation-samples-hint"
            aria-invalid={!valid}
            className="h-9 w-32 rounded-lg border border-border bg-bg-elev px-2 font-mono text-xs tabular-nums text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={!valid || running}
          loading={running}
          iconLeft={<FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />}
        >
          {running ? 'Running…' : 'Run ablation'}
        </Button>

        <p id="ablation-samples-hint" className="text-[11px] text-muted">
          {formatNumber(MIN_SAMPLES)}–{formatNumber(MAX_SAMPLES)} labelled claims, scored twice:
          once with the verifier in the loop, once without.
        </p>
      </div>

      {running && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress > 0 ? Math.round(progress * 100) : undefined}
          >
            {progress > 0 ? (
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
              />
            ) : (
              <div className="shimmer animate-shimmer h-full w-full" />
            )}
          </div>
          <p className="font-mono text-[11px] tabular-nums text-muted">
            Scoring {formatNumber(Math.round(samples))} claims in both arms
            {stage ? ` · ${stage}` : ''}
            {progress > 0 ? ` · ${Math.round(progress * 100)}%` : ''} · {formatNumber(elapsed)}s
            elapsed
          </p>
        </div>
      )}

      {error != null && !running && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[rgb(var(--ungrounded-rgb)/0.35)] bg-[rgb(var(--ungrounded-rgb)/0.08)] p-2.5 text-xs text-ungrounded"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The ablation did not complete — {describeError(error)}
        </p>
      )}

      {finishedLabel && !running && error == null && (
        <p className="flex items-start gap-2 text-xs text-grounded">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="text-text">
            Finished <span className="font-mono">{finishedLabel}</span> — the report below is
            this run.
          </span>
        </p>
      )}
    </form>
  );
}

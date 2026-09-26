/**
 * The methodology note. Prose on purpose: a number without its protocol is a
 * marketing claim, and the section that says what the result does *not* prove
 * is the one that makes the rest credible.
 */
import type { AblationReport } from '@/lib/types';

import { formatDateTime, formatNumber } from '@/lib/format';

export interface MethodologyProps {
  /** The run being displayed, so the prose names the real dataset and size. */
  report: AblationReport | null;
}

export default function Methodology({ report }: MethodologyProps) {
  const arm = report?.arms.find((candidate) => candidate.arm === 'verifier_on') ?? null;

  return (
    <div className="flex flex-col gap-5 text-xs leading-relaxed text-muted">
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text">
          The datasets
        </h3>
        <p>
          Two public corpora, neither of them written by us. <strong className="text-text">CUAD</strong>{' '}
          (Contract Understanding Atticus Dataset) supplies{' '}
          <span className="font-mono tabular-nums text-text">510</span> commercial contracts with
          expert-annotated clause spans across 41 legal categories; it is what the extractor reads
          and what the clause classifier is scored against.{' '}
          <strong className="text-text">ContractNLI</strong> supplies{' '}
          <span className="font-mono tabular-nums text-text">607</span> non-disclosure agreements
          annotated with entailment labels — for each document–hypothesis pair, whether the contract
          entails the statement, contradicts it, or says nothing about it. That label set is what
          makes the verifier measurable rather than merely plausible.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text">
          What the verifier is
        </h3>
        <p>
          The verifier is a <strong className="text-text">DeBERTa-v3</strong> cross-encoder applied
          as natural-language inference. Each extracted obligation is turned into a pair: the source
          clause is the <em className="text-text">premise</em>, the generated claim is the{' '}
          <em className="text-text">hypothesis</em>. The model returns a three-way distribution —
          entailment, neutral, contradiction — and the claim is tracked only when entailment clears
          the calibrated threshold with enough margin. It is a second model checking the first
          model's homework against the document, not a confidence score the extractor assigned
          itself.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text">
          The two arms
        </h3>
        <p>
          <strong className="text-text">Verifier OFF</strong> is the baseline the industry ships:
          the extractor's output is tracked as-is. <strong className="text-text">Verifier ON</strong>{' '}
          routes the identical extractions through the entailment check first — anything that fails
          is rejected or escalated to the review queue instead of quietly becoming a tracked
          obligation. Both arms run the same pipeline over the same sample with the same seed, so
          the only variable is the verification step.{' '}
          {report && arm ? (
            <>
              The run on screen —{' '}
              <span className="font-mono text-text">{report.run_label}</span> over{' '}
              <span className="font-mono tabular-nums text-text">
                {formatNumber(arm.n_samples)}
              </span>{' '}
              samples of <span className="font-mono text-text">{report.dataset}</span>, recorded{' '}
              {formatDateTime(report.created_at)} — is a single such pairing.
            </>
          ) : (
            'No run has been recorded yet, so the tables above are empty.'
          )}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text">
          What the numbers prove — and what they do not
        </h3>
        <p>
          <span className="text-text">They do show</span> that inserting the entailment check lowers
          the false-obligation rate on this sample, and what that costs in recall: obligations the
          clause did not clearly support stop being tracked, and some genuine ones go with them.
          That trade is the product decision, and the calibration sweep above is where it was made.
        </p>
        <p>
          <span className="text-text">They do not show</span> that the system is correct on your
          contracts. The sample is drawn from public agreements in English, weighted toward US
          commercial and NDA language; the labels are a proxy for legal truth, not legal advice; a
          single run carries sampling error, and no confidence intervals are reported here. A
          sample of a few hundred claims measures a direction, not a guarantee — re-run it on your
          own corpus before treating any of these figures as an SLA.
        </p>
        {report?.notes && (
          <p className="rounded-lg border border-border bg-surface p-2.5 text-[11px] text-muted">
            <span className="font-medium text-text">Run notes: </span>
            {report.notes}
          </p>
        )}
      </section>
    </div>
  );
}

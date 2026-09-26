/**
 * Metric vocabulary for the ablation and calibration reports.
 *
 * The API types these as `dict[str, float]`, so the screen must render whatever
 * arrives: known metrics get a label and a direction, unknown ones fall back to
 * a humanised key rather than being dropped.
 */
import { humanize } from '@/lib/format';
import type { AblationArmName } from '@/lib/types';

export interface MetricMeta {
  label: string;
  /** Axis-sized label for narrow charts. */
  short: string;
  description: string;
  /** False for error rates, where a lower number is the better one. */
  higherIsBetter: boolean;
}

export const METRIC_META: Record<string, MetricMeta> = {
  precision: {
    label: 'Precision',
    short: 'Precision',
    description: 'Of the obligations the system tracked, the share that were real.',
    higherIsBetter: true,
  },
  recall: {
    label: 'Recall',
    short: 'Recall',
    description: 'Of the real obligations in the sample, the share the system found.',
    higherIsBetter: true,
  },
  f1: {
    label: 'F1',
    short: 'F1',
    description: 'Harmonic mean of precision and recall — the single headline number.',
    higherIsBetter: true,
  },
  false_obligation_rate: {
    label: 'False obligation rate',
    short: 'False obligation rate',
    description:
      'The hallucination measure: tracked obligations the source clause does not support.',
    higherIsBetter: false,
  },
  accuracy: {
    label: 'Accuracy',
    short: 'Accuracy',
    description: 'Share of decisions that matched the label.',
    higherIsBetter: true,
  },
};

/** Preferred display order; anything unknown is appended alphabetically. */
const ORDER = ['precision', 'recall', 'f1', 'accuracy', 'false_obligation_rate'];

export function metricMeta(key: string): MetricMeta {
  return (
    METRIC_META[key] ?? {
      label: humanize(key),
      short: humanize(key),
      description: 'Reported by the backend for this run.',
      higherIsBetter: true,
    }
  );
}

export function orderMetrics(keys: Iterable<string>): string[] {
  const unique = [...new Set(keys)];
  return unique.sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

export interface ArmMeta {
  label: string;
  /** CSS custom property reference. Validated for CVD separation against its pair. */
  color: string;
  description: string;
}

/**
 * Two series only, so the pair is chosen for maximum separation inside the
 * product's token set: verification blue against the indecision amber.
 */
export const ARM_META: Record<AblationArmName, ArmMeta> = {
  verifier_on: {
    label: 'Verifier ON',
    color: 'var(--accent)',
    description: 'Every extracted claim is re-checked against its clause before it is tracked.',
  },
  verifier_off: {
    label: 'Verifier OFF',
    color: 'var(--uncertain)',
    description: 'The extractor is trusted as-is — the industry-standard baseline.',
  },
};

/** Signed improvement for a metric, accounting for error rates being inverted. */
export function improvement(key: string, delta: number): 'better' | 'worse' | 'flat' {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-6) return 'flat';
  const better = metricMeta(key).higherIsBetter ? delta > 0 : delta < 0;
  return better ? 'better' : 'worse';
}

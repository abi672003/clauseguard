import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import Badge, { type BadgeTone } from '@/components/ui/Badge';
import { formatPct } from '@/lib/format';
import type { Verdict } from '@/lib/types';

export interface VerdictChipProps {
  verdict: Verdict;
  /** Entailment probability (0–1) rendered alongside the label. */
  score?: number | null;
  size?: 'xs' | 'sm';
  showLabel?: boolean;
  className?: string;
}

const VERDICT_META: Record<Verdict, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  grounded: { label: 'Grounded', tone: 'grounded', icon: ShieldCheck },
  uncertain: { label: 'Uncertain', tone: 'uncertain', icon: ShieldAlert },
  ungrounded: { label: 'Ungrounded', tone: 'ungrounded', icon: ShieldX },
};

/** Verdict -> design token + icon. The single source of verdict styling. */
export default function VerdictChip({
  verdict,
  score,
  size = 'sm',
  showLabel = true,
  className,
}: VerdictChipProps) {
  const { label, tone, icon: Icon } = VERDICT_META[verdict];

  return (
    <Badge
      tone={tone}
      size={size}
      className={className}
      title={
        score === null || score === undefined
          ? label
          : `${label} — entailment ${formatPct(score)}`
      }
    >
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
      {showLabel && <span>{label}</span>}
      {score !== null && score !== undefined && (
        <span className="font-mono tabular-nums opacity-80">{formatPct(score, 0)}</span>
      )}
    </Badge>
  );
}

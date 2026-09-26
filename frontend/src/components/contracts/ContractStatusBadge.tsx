import { CheckCircle2, CircleDashed, Loader2, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import Badge from '@/components/ui/Badge';
import { humanize } from '@/lib/format';
import { statusTone } from '@/components/contracts/helpers';

const ICON: Record<string, LucideIcon> = {
  complete: CheckCircle2,
  processing: Loader2,
  pending: CircleDashed,
  failed: TriangleAlert,
};

export interface ContractStatusBadgeProps {
  status: string;
  size?: 'xs' | 'sm';
  className?: string;
}

/** Pipeline status of one contract — the only place status styling is decided. */
export default function ContractStatusBadge({
  status,
  size = 'sm',
  className,
}: ContractStatusBadgeProps) {
  const Icon = ICON[status] ?? CircleDashed;
  const spinning = status === 'processing';

  return (
    <Badge tone={statusTone(status)} size={size} className={className} title={`Status: ${status}`}>
      <Icon
        aria-hidden="true"
        className={`h-3 w-3 shrink-0 ${spinning ? 'motion-safe:animate-spin' : ''}`}
      />
      <span>{humanize(status)}</span>
    </Badge>
  );
}

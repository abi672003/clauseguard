import { cn } from '@/lib/format';

export interface SkeletonProps {
  className?: string;
  /** Convenience for the common "n stacked lines" case. */
  lines?: number;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

const RADIUS: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  sm: 'rounded',
  md: 'rounded-md',
  lg: 'rounded-xl',
  full: 'rounded-full',
};

/** Loading placeholder. Always prefer this over a spinner. */
export default function Skeleton({ className, lines, rounded = 'md' }: SkeletonProps) {
  const base = cn('shimmer animate-shimmer bg-surface', RADIUS[rounded]);

  if (lines && lines > 1) {
    return (
      <div className="flex w-full flex-col gap-2" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn(base, 'h-3', i === lines - 1 && 'w-2/3', className)}
          />
        ))}
      </div>
    );
  }

  return <div aria-hidden="true" className={cn(base, 'h-4 w-full', className)} />;
}

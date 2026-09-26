import Skeleton from '@/components/ui/Skeleton';

/** Route-level loading fallback used by every lazy page. */
export default function PageSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" rounded="lg" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" rounded="lg" />
        <Skeleton className="h-72" rounded="lg" />
      </div>
    </div>
  );
}

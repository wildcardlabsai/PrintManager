import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-[1400px] space-y-2 px-4 py-4 lg:px-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-4 lg:px-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    </div>
  );
}

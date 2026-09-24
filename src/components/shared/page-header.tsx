import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b bg-card", className)}>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <div className="min-w-0 space-y-1">
          {back && (
            <Link
              href={back.href}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeftIcon className="size-3.5" />
              {back.label}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
            {meta}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-[1400px] space-y-4 px-4 py-4 lg:px-6 lg:py-5", className)}>{children}</div>;
}

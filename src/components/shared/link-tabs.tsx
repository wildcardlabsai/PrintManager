import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (each tab is a link, so views are shareable and work without JS). */
export function LinkTabs({
  tabs,
  active,
  className,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  active: string;
  className?: string;
}) {
  return (
    <nav aria-label="Views" className={cn("-mb-px flex gap-1 overflow-x-auto", className)}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
              isActive && "border-primary text-foreground",
            )}
          >
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  "tabular rounded bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground",
                  isActive && "bg-primary/10 text-primary",
                )}
              >
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

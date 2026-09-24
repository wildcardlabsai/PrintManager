import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageCount,
  total,
  basePath,
  params,
  noun = "results",
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  noun?: string;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
      <span className="tabular">
        {total} {noun}
        {pageCount > 1 && ` · page ${page} of ${pageCount}`}
      </span>
      {pageCount > 1 && (
        <div className="flex gap-1">
          {page > 1 ? (
            <Button asChild variant="outline" size="xs">
              <Link href={href(page - 1)} aria-label="Previous page">
                <ChevronLeftIcon /> Prev
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="xs" disabled>
              <ChevronLeftIcon /> Prev
            </Button>
          )}
          {page < pageCount ? (
            <Button asChild variant="outline" size="xs">
              <Link href={href(page + 1)} aria-label="Next page">
                Next <ChevronRightIcon />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="xs" disabled>
              Next <ChevronRightIcon />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

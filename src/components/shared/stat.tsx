import Link from "next/link";
import { cn } from "@/lib/utils";

/** Compact metric used in dashboard strips. */
export function Stat({
  label,
  value,
  sub,
  href,
  emphasis,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  emphasis?: "warning" | "danger" | null;
  className?: string;
}) {
  const body = (
    <>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular text-xl font-semibold tracking-tight",
          emphasis === "warning" && "text-amber-700",
          emphasis === "danger" && "text-red-700",
        )}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </>
  );
  const cls = cn("flex min-w-0 flex-col gap-0.5 px-4 py-3", className);
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:bg-muted/50")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

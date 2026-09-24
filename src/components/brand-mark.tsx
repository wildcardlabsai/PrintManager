import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

export function BrandMark({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" aria-hidden className="size-6 shrink-0">
        <rect width="24" height="24" rx="5" className="fill-primary" />
        <path d="M6 16.5h12M8 13h8M10 9.5h4M11.2 6h1.6" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {showName && <span>{brand.name}</span>}
    </span>
  );
}

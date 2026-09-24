import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-slate-400",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  violet: "bg-indigo-500",
  cyan: "bg-cyan-500",
  slate: "bg-slate-500",
  outline: "bg-slate-300",
};

/** Status label with a coloured dot; the text carries the meaning, colour only supports it. */
export function StatusBadge({ meta, className }: { meta: { label: string; tone: BadgeTone }; className?: string }) {
  return (
    <Badge tone={meta.tone} className={className}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[meta.tone])} />
      {meta.label}
    </Badge>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="outline" className={cn("border-dashed text-[10px] uppercase tracking-wide", className)} title="Demo data — remove it from Settings">
      Demo
    </Badge>
  );
}

import type { PrinterTelemetry } from "../../../agent/src/protocol";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { PRINTER_STATUS_META } from "@/lib/domain/labels";
import { connectionView, effectivePrinterStatus, formatDuration, secondsSince } from "@/lib/printers/status";
import type { Printer } from "@/types/db";
import { cn } from "@/lib/utils";

export const NA = <span className="text-muted-foreground">Not available</span>;

export function valueOrNA(v: React.ReactNode | null | undefined) {
  return v === null || v === undefined || v === "" ? NA : v;
}

export function temp(current: number | null | undefined, target: number | null | undefined) {
  if (current == null) return NA;
  return (
    <span className="tabular">
      {Math.round(current)}°C{target ? <span className="text-muted-foreground"> / {Math.round(target)}°C</span> : null}
    </span>
  );
}

export function ago(iso: string | null | undefined, now: Date) {
  const s = secondsSince(iso, now);
  if (!Number.isFinite(s)) return "never";
  if (s < 5) return "just now";
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function PrinterBadges({ printer, now, offlineAfter }: { printer: Printer; now: Date; offlineAfter: number }) {
  const status = effectivePrinterStatus(printer, now, offlineAfter);
  const conn = connectionView(printer, now, offlineAfter);
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      <StatusBadge meta={PRINTER_STATUS_META[status]} />
      <Badge tone={conn.tone} title={conn.detail}>
        {conn.label}
      </Badge>
    </span>
  );
}

export function Swatch({ colour, className }: { colour: string | null | undefined; className?: string }) {
  const valid = colour && /^#[0-9a-f]{6}/i.test(colour);
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3 shrink-0 rounded-full border", !valid && "bg-[repeating-linear-gradient(45deg,#ddd,#ddd_2px,#fff_2px,#fff_4px)]", className)}
      style={valid ? { backgroundColor: colour!.slice(0, 7) } : undefined}
    />
  );
}

/** Filament as the printer reports it — IFS slots on the AD5X, otherwise the loaded filament. */
export function LoadedFilament({ t }: { t: PrinterTelemetry | null }) {
  if (!t) return NA;
  const station = t.materialStation;
  if (station && station.slots.length) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {station.slots.map((s) => (
          <span
            key={s.slotId}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-px text-xs",
              station.currentSlot === s.slotId && "border-primary",
              !s.hasFilament && "text-muted-foreground",
            )}
            title={station.currentSlot === s.slotId ? "Active slot" : undefined}
          >
            <span className="text-muted-foreground">{s.slotId}</span>
            {s.hasFilament ? (
              <>
                <Swatch colour={s.colour} />
                {s.material ?? "?"}
              </>
            ) : (
              "empty"
            )}
          </span>
        ))}
      </span>
    );
  }
  const material = t.directFeed?.material ?? t.rightFilamentType;
  const colour = t.directFeed?.colour ?? null;
  if (!material && !colour) return NA;
  return (
    <span className="inline-flex items-center gap-1.5">
      {colour && <Swatch colour={colour} />}
      {material ?? "Unknown material"}
      {colour && <span className="font-mono text-xs text-muted-foreground">{colour}</span>}
    </span>
  );
}

export function TelemetryProgress({
  progress,
  layer,
  totalLayers,
  elapsedSeconds,
  remainingSeconds,
  paused,
}: {
  progress: number | null;
  layer: number | null;
  totalLayers: number | null;
  elapsedSeconds: number | null;
  remainingSeconds: number | null;
  paused?: boolean;
}) {
  const pct = progress == null ? null : Math.max(0, Math.min(100, progress));
  return (
    <div className="space-y-1">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Print progress reported by the printer"
      >
        {pct != null && <div className={paused ? "h-full bg-slate-400" : "h-full bg-primary"} style={{ width: `${pct}%` }} />}
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span className="tabular">
          {pct == null ? "Progress not available" : `${pct.toFixed(pct < 10 ? 1 : 0)}%`}
          {layer != null && totalLayers ? ` · layer ${layer} / ${totalLayers}` : ""}
        </span>
        <span className="tabular">
          {elapsedSeconds != null ? `${formatDuration(elapsedSeconds)} elapsed` : ""}
          {remainingSeconds != null ? ` · ~${formatDuration(remainingSeconds)} left` : ""}
        </span>
      </div>
    </div>
  );
}

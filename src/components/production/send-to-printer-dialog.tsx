"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, Loader2Icon, SendIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import type { MaterialMapping } from "../../../agent/src/protocol";
import { detectModel } from "../../../agent/src/protocol";
import { previewDispatchAction, sendJobToPrinterAction, sendTestPrintAction } from "@/actions/printer-control";
import { LoadedFilament, Swatch } from "@/components/printers/telemetry-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { useCommandWatch } from "@/hooks/use-command-watch";
import { formatDuration } from "@/lib/domain/dates";
import type { Suggestion } from "@/lib/printers/assignment";
import { fileSupportsModel, suggestMappings } from "@/lib/printers/dispatch";
import type { DispatchPreview } from "@/lib/services/printers/control";
import type { FilamentAssignment, PrintFile } from "@/types/db";

export type SendFile = Pick<
  PrintFile,
  | "id"
  | "name"
  | "compatible_models"
  | "verified_at"
  | "multi_colour"
  | "ifs_required"
  | "colour_channels"
  | "filament_assignments"
  | "estimated_minutes"
  | "estimated_grams"
  | "material"
  | "colour"
  | "file_type"
>;

export interface SendPrinter {
  id: string;
  name: string;
  model: string;
  connected: boolean;
}

interface Options {
  levelingBeforePrint: boolean;
  flowCalibration: boolean;
  firstLayerInspection: boolean;
  timeLapseVideo: boolean;
}

const OPTION_LABELS: [keyof Options, string][] = [
  ["levelingBeforePrint", "Level the bed before printing"],
  ["flowCalibration", "Flow calibration"],
  ["firstLayerInspection", "First-layer inspection"],
  ["timeLapseVideo", "Time-lapse video"],
];

/**
 * The confirmation step before a physical print starts. It shows exactly
 * which printer, product and file will be used, runs the server's pre-flight
 * checks, and requires every warning to be acknowledged. Nothing starts until
 * the person presses the final button.
 */
export function SendToPrinterDialog({
  mode,
  jobId,
  summary,
  printers,
  files,
  suggestions,
  defaultPrinterId,
  defaultFileId,
  trigger,
}: {
  mode: "job" | "test";
  jobId?: string;
  summary: { title: string; product: string; quantity?: number; estimatedMinutes?: number | null; material?: string | null; colour?: string | null };
  printers: SendPrinter[];
  files: SendFile[];
  suggestions?: Suggestion[];
  defaultPrinterId?: string | null;
  defaultFileId?: string | null;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const firstConnected = printers.find((p) => p.connected)?.id ?? "";
  const [printerId, setPrinterId] = useState<string>(
    defaultPrinterId && printers.some((p) => p.id === defaultPrinterId && p.connected) ? defaultPrinterId : firstConnected,
  );
  const printer = printers.find((p) => p.id === printerId) ?? null;
  const model = detectModel(printer?.model);
  const usable = useMemo(() => files.filter((f) => fileSupportsModel(f, model)), [files, model]);
  const [chosenFileId, setFileId] = useState<string>(defaultFileId ?? "");
  // Fall back to a sensible file for the chosen printer when the choice doesn't fit it.
  const fileId = usable.some((f) => f.id === chosenFileId)
    ? chosenFileId
    : (usable.find((f) => f.id === defaultFileId) ?? usable.find((f) => f.verified_at) ?? usable[0])?.id ?? "";
  const file = usable.find((f) => f.id === fileId) ?? null;
  const [mappings, setMappings] = useState<MaterialMapping[]>([]);
  const [options, setOptions] = useState<Options>({ levelingBeforePrint: true, flowCalibration: false, firstLayerInspection: false, timeLapseVideo: false });
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [acked, setAcked] = useState<string[]>([]);
  const { pending, execute } = useAction();
  const { watch } = useCommandWatch();

  // Server-side pre-flight whenever the choice changes.
  useEffect(() => {
    if (!open || !printerId) return;
    let cancelled = false;
    const run = async () => {
      setChecking(true);
      const r = await previewDispatchAction({ jobId: jobId ?? null, printerId, printFileId: fileId || null, mappings, testPrint: mode === "test" });
      if (cancelled) return;
      setChecking(false);
      if (r.ok) {
        setPreview(r.data);
        setAcked((a) => a.filter((w) => r.data.warnings.includes(w)));
        // Offer an IFS mapping only when every colour has one unambiguous match.
        if (r.data.file?.ifs_required && mappings.length === 0) {
          const s = suggestMappings(r.data.file, r.data.printer.telemetry);
          if (s) setMappings(s);
        }
      } else setPreview(null);
    };
    const t = setTimeout(run, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, printerId, fileId, mappings, jobId, mode]);

  const slots = (preview?.printer.telemetry?.materialStation?.slots ?? []).filter((s) => s.hasFilament);
  const blockers = preview?.blockers ?? [];
  const warnings = preview?.warnings ?? [];
  const ready = preview && !checking && blockers.length === 0 && warnings.every((w) => acked.includes(w)) && file;

  function setMapping(toolId: number, slotId: number) {
    const a: FilamentAssignment | undefined = file?.filament_assignments.find((x) => x.channel === toolId + 1);
    const slot = slots.find((s) => s.slotId === slotId);
    setMappings((prev) => [
      ...prev.filter((m) => m.toolId !== toolId),
      {
        toolId,
        slotId,
        materialName: a?.material ?? slot?.material ?? "",
        toolMaterialColor: a?.colour ?? slot?.colour ?? "",
        slotMaterialColor: slot?.colour ?? "",
      },
    ].sort((x, y) => x.toolId - y.toolId));
  }

  async function submit() {
    if (!file || !printer) return;
    const input = { printerId, printFileId: file.id, options, materialMappings: file.ifs_required ? mappings : [], acknowledgedWarnings: acked };
    const r = await execute(() => (mode === "job" ? sendJobToPrinterAction(jobId!, input) : sendTestPrintAction(input)));
    if (r.ok) {
      setOpen(false);
      void watch(r.data.commandId, { timeoutMs: 10 * 60_000 });
    }
  }

  const estimate = file?.estimated_minutes ?? summary.estimatedMinutes ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPreview(null);
          setAcked([]);
          setMappings([]);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "job" ? "Send to printer" : "Send a test print"}</DialogTitle>
          <DialogDescription>
            {mode === "job"
              ? "Check the details. The printer starts as soon as the file has been uploaded."
              : "Use a small, harmless file and stay with the printer while it runs."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65dvh] space-y-4 overflow-y-auto pr-1 text-[13px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="send-printer">Printer</Label>
              <Select
                value={printerId}
                onValueChange={(v) => {
                  setPrinterId(v);
                  setMappings([]);
                }}
              >
                <SelectTrigger id="send-printer">
                  <SelectValue placeholder="Choose a printer" />
                </SelectTrigger>
                <SelectContent>
                  {printers.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={!p.connected}>
                      {p.name}
                      {!p.connected && " (not connected)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="send-file">Print file</Label>
              <Select
                value={fileId}
                onValueChange={(v) => {
                  setFileId(v);
                  setMappings([]);
                }}
              >
                <SelectTrigger id="send-file">
                  <SelectValue placeholder={usable.length ? "Choose a file" : "No file for this printer"} />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                      {f.verified_at ? " ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {suggestions && suggestions.length > 0 && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <p className="mb-1 inline-flex items-center gap-1 font-medium">
                <SparklesIcon className="size-3.5" /> Suggestions (you decide)
              </p>
              <ul className="space-y-0.5">
                {suggestions.slice(0, 3).map((s) => (
                  <li key={s.printerId}>
                    <span className="font-medium">{s.printerName}</span>
                    {s.reasons.length > 0 && <span className="text-emerald-700"> · {s.reasons.join(", ")}</span>}
                    {s.concerns.length > 0 && <span className="text-amber-800"> · {s.concerns.join(", ")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {file?.ifs_required && (
            <div className="space-y-2 rounded-md border px-3 py-2.5">
              <p className="font-medium">IFS colour mapping</p>
              <p className="text-xs text-muted-foreground">
                Map each colour in the file to a loaded IFS slot. PrintFlow does not change filament; the slots are what the printer reports.
              </p>
              {Array.from({ length: Math.max(1, file.colour_channels) }, (_, tool) => {
                const a = file.filament_assignments.find((x) => x.channel === tool + 1);
                const current = mappings.find((m) => m.toolId === tool);
                return (
                  <div key={tool} className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex w-40 items-center gap-1.5">
                      <Swatch colour={a?.colour} /> Colour {tool + 1} {a?.material ? `· ${a.material}` : ""}
                    </span>
                    <Select value={current ? String(current.slotId) : ""} onValueChange={(v) => setMapping(tool, Number(v))}>
                      <SelectTrigger className="h-8 w-44" aria-label={`IFS slot for colour ${tool + 1}`}>
                        <SelectValue placeholder="Choose slot" />
                      </SelectTrigger>
                      <SelectContent>
                        {slots.map((s) => (
                          <SelectItem key={s.slotId} value={String(s.slotId)}>
                            Slot {s.slotId} · {s.material ?? "?"} {s.colour ?? ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}

          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Printer options (applied by the printer if supported)</legend>
            {OPTION_LABELS.map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox id={`opt-${key}`} checked={options[key]} onCheckedChange={(v) => setOptions((o) => ({ ...o, [key]: v === true }))} />
                <Label htmlFor={`opt-${key}`} className="font-normal">
                  {label}
                </Label>
              </div>
            ))}
          </fieldset>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border px-3 py-2.5">
            <dt className="text-muted-foreground">Job</dt>
            <dd>{summary.title}</dd>
            <dt className="text-muted-foreground">Product</dt>
            <dd>
              {summary.product}
              {summary.quantity ? ` × ${summary.quantity}` : ""}
            </dd>
            <dt className="text-muted-foreground">Printer</dt>
            <dd>{printer?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">File</dt>
            <dd className="break-all">{file?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Estimated time</dt>
            <dd>{estimate != null ? formatDuration(estimate) : "Not available"}</dd>
            <dt className="text-muted-foreground">Loaded filament</dt>
            <dd>
              <LoadedFilament t={preview?.printer.telemetry ?? null} />
            </dd>
          </dl>

          {checking && (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" /> Checking with the latest printer status…
            </p>
          )}
          {blockers.length > 0 && (
            <ul className="space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900" role="alert">
              {blockers.map((b) => (
                <li key={b} className="flex gap-1.5">
                  <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {b}
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">Check and confirm:</p>
              {warnings.map((w, i) => (
                <div key={w} className="flex items-start gap-2">
                  <Checkbox
                    id={`ack-${i}`}
                    checked={acked.includes(w)}
                    onCheckedChange={(v) => setAcked((a) => (v === true ? [...a, w] : a.filter((x) => x !== w)))}
                  />
                  <Label htmlFor={`ack-${i}`} className="font-normal leading-snug">
                    <TriangleAlertIcon className="mr-1 inline size-3.5" />
                    {w}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {printer ? `Start print on ${printer.name}` : "Start print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

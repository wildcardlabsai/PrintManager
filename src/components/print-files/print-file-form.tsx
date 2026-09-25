"use client";

import { useState } from "react";
import { FileUpIcon, Loader2Icon, PencilIcon } from "lucide-react";
import { detectModel } from "../../../agent/src/protocol";
import { createPrintFileAction, updatePrintFileAction } from "@/actions/print-files";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import {
  classifyFileName,
  listZipEntries,
  parseGcodeMetadata,
  parseSliceInfo,
  sliced3mfGcodeEntries,
  zipEntryData,
  type SlicerMetadata,
} from "@/lib/printers/slicer-metadata";
import { createClient } from "@/lib/supabase/client";
import type { FilamentAssignment, PrintFile, PrintFileType } from "@/types/db";

export interface ProductChoice {
  id: string;
  name: string;
  sku: string;
}

const MODELS = ["AD5X", "Adventurer 5M"] as const;
const HEAD = 512 * 1024;

async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function inflateRaw(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** Reads what the slicer recorded. Rejects unsliced models and 3MF projects without G-code. */
async function inspectFile(file: File, buf: ArrayBuffer, type: PrintFileType): Promise<Partial<SlicerMetadata>> {
  if (type === "3mf") {
    const bytes = new Uint8Array(buf);
    const entries = listZipEntries(bytes);
    if (!sliced3mfGcodeEntries(entries).length) {
      throw new Error("This 3MF has no sliced G-code in it. Slice it for the printer first and export the sliced file (e.g. “Export plate sliced file” / send-ready 3MF).");
    }
    const info = entries.find((e) => e.name.toLowerCase() === "metadata/slice_info.config");
    if (!info) return {};
    const raw = zipEntryData(bytes, info);
    const xml = info.method === 8 ? await inflateRaw(raw) : new TextDecoder().decode(raw);
    return parseSliceInfo(xml);
  }
  const dec = new TextDecoder("utf-8", { fatal: false });
  const head = dec.decode(buf.slice(0, HEAD));
  const tail = file.size > HEAD ? dec.decode(buf.slice(Math.max(HEAD, file.size - HEAD))) : "";
  if (!/^\s*(;|G\d|M\d)/m.test(head) && type === "gcode") throw new Error("This doesn't look like G-code.");
  return parseGcodeMetadata(`${head}\n${tail}`);
}

type Meta = {
  name: string;
  product_id: string;
  compatible_models: string[];
  slicer: string;
  slicer_version: string;
  printer_profile: string;
  material: string;
  colour: string;
  nozzle_diameter: string;
  multi_colour: boolean;
  colour_channels: number;
  ifs_required: boolean;
  filament_assignments: FilamentAssignment[];
  estimated_minutes: string;
  estimated_grams: string;
  is_default: boolean;
  notes: string;
};

function fromFile(f?: PrintFile | null, productId?: string | null): Meta {
  return {
    name: f?.name ?? "",
    product_id: f?.product_id ?? productId ?? "",
    compatible_models: f?.compatible_models ?? [],
    slicer: f?.slicer ?? "",
    slicer_version: f?.slicer_version ?? "",
    printer_profile: f?.printer_profile ?? "",
    material: f?.material ?? "",
    colour: f?.colour ?? "",
    nozzle_diameter: f?.nozzle_diameter != null ? String(f.nozzle_diameter) : "",
    multi_colour: f?.multi_colour ?? false,
    colour_channels: f?.colour_channels ?? 1,
    ifs_required: f?.ifs_required ?? false,
    filament_assignments: f?.filament_assignments ?? [],
    estimated_minutes: f?.estimated_minutes != null ? String(f.estimated_minutes) : "",
    estimated_grams: f?.estimated_grams != null ? String(f.estimated_grams) : "",
    is_default: f?.is_default ?? false,
    notes: f?.notes ?? "",
  };
}

/**
 * Upload (or edit) a sliced print file. The file goes straight from the
 * browser to private storage; PrintFlow never slices anything.
 */
export function PrintFileDialog({
  orgId,
  products,
  file: existing,
  productId,
  trigger,
}: {
  orgId: string;
  products: ProductChoice[];
  file?: PrintFile | null;
  productId?: string | null;
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<Meta>(() => fromFile(existing, productId));
  const [picked, setPicked] = useState<{ file: File; type: PrintFileType; buf: ArrayBuffer; sha: string } | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setMeta((m) => ({ ...m, [k]: v }));

  async function onPick(f: File | undefined) {
    setPicked(null);
    setInspectError(null);
    if (!f) return;
    const kind = classifyFileName(f.name);
    if ("error" in kind) return setInspectError(kind.error);
    if (f.size > 200 * 1024 * 1024) return setInspectError("Files can be up to 200 MB.");
    setInspecting(true);
    try {
      const buf = await f.arrayBuffer();
      const info = await inspectFile(f, buf, kind.type);
      const sha = await sha256Hex(buf);
      setPicked({ file: f, type: kind.type, buf, sha });
      const filaments = info.filaments ?? [];
      const multi = filaments.length > 1;
      const detected = detectModel(info.printerModel ?? info.printerProfile ?? "");
      setMeta((m) => ({
        ...m,
        name: m.name || f.name.replace(/\.(gcode|gx|3mf|g)$/i, "").replace(/\.gcode$/i, ""),
        slicer: info.slicer ?? m.slicer,
        slicer_version: info.slicerVersion ?? m.slicer_version,
        printer_profile: info.printerProfile ?? info.printerModel ?? m.printer_profile,
        compatible_models: detected ? [detected === "AD5X" ? "AD5X" : "Adventurer 5M"] : m.compatible_models,
        material: filaments[0]?.material ?? m.material,
        colour: !multi ? (filaments[0]?.colour ?? m.colour) : m.colour,
        nozzle_diameter: info.nozzleDiameter != null ? String(info.nozzleDiameter) : m.nozzle_diameter,
        multi_colour: multi,
        colour_channels: multi ? filaments.length : 1,
        ifs_required: multi && detected === "AD5X",
        filament_assignments: filaments,
        estimated_minutes: info.estimatedSeconds != null ? String(Math.round(info.estimatedSeconds / 60)) : m.estimated_minutes,
        estimated_grams: info.filamentGrams != null ? String(info.filamentGrams) : m.estimated_grams,
      }));
    } catch (e) {
      setInspectError((e as Error).message);
    } finally {
      setInspecting(false);
    }
  }

  function payload() {
    return {
      ...meta,
      product_id: meta.product_id || null,
      variant_id: null,
      colour_channels: meta.multi_colour ? meta.colour_channels : 1,
      ifs_required: meta.multi_colour && meta.ifs_required,
      filament_assignments: meta.multi_colour ? meta.filament_assignments.slice(0, meta.colour_channels) : meta.filament_assignments.slice(0, 1),
    };
  }

  async function submit() {
    setErrors({});
    if (existing) {
      const r = await execute(() => updatePrintFileAction(existing.id, payload()), { onSuccess: () => setOpen(false) });
      if (!r.ok) setErrors(r.fieldErrors ?? {});
      return;
    }
    if (!picked) return setInspectError("Choose a sliced file first.");
    setUploading(true);
    const safe = picked.file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 180);
    const path = `${orgId}/${crypto.randomUUID()}/${safe}`;
    const { error } = await createClient()
      .storage.from("print-files")
      .upload(path, new Blob([picked.buf]), { contentType: "application/octet-stream", upsert: false });
    setUploading(false);
    if (error) return setInspectError(`Upload failed: ${error.message}`);
    const r = await execute(
      () =>
        createPrintFileAction(
          { storage_path: path, file_name: picked.file.name, file_type: picked.type, size_bytes: picked.file.size, sha256: picked.sha, metadata: {} },
          payload(),
        ),
      {
        onSuccess: () => {
          setOpen(false);
          setPicked(null);
          setMeta(fromFile(null, productId));
        },
      },
    );
    if (!r.ok) setErrors(r.fieldErrors ?? {});
  }

  const busy = pending || uploading || inspecting;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            {existing ? <PencilIcon /> : <FileUpIcon />} {existing ? "Edit" : "Upload print file"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : "Upload a sliced print file"}</DialogTitle>
          <DialogDescription>
            Upload the file your slicer produced for a specific printer (.gcode, .gx or a sliced .3mf). PrintFlow reads the slicer&apos;s notes to fill in
            the details — check them before saving.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65dvh] space-y-3 overflow-y-auto pr-1">
          {!existing && (
            <Field id="pf-file" label="File" required error={inspectError}>
              <Input id="pf-file" type="file" accept=".gcode,.gx,.3mf,.g" onChange={(e) => onPick(e.target.files?.[0])} disabled={busy} />
            </Field>
          )}
          {inspecting && (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" /> Reading file…
            </p>
          )}
          {picked && <p className="font-mono text-[11px] break-all text-muted-foreground">SHA-256 {picked.sha}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pf-name" label="Name" required error={errors.name} className="sm:col-span-2">
              <Input id="pf-name" value={meta.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field id="pf-product" label="Product" error={errors.product_id}>
              <Select value={meta.product_id || "__none"} onValueChange={(v) => set("product_id", v === "__none" ? "" : v)}>
                <SelectTrigger id="pf-product">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not linked to a product</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Sliced for</legend>
              {MODELS.map((m) => (
                <div key={m} className="flex items-center gap-2">
                  <Checkbox
                    id={`pf-m-${m}`}
                    checked={meta.compatible_models.includes(m)}
                    onCheckedChange={(v) => set("compatible_models", v === true ? [...meta.compatible_models, m] : meta.compatible_models.filter((x) => x !== m))}
                  />
                  <Label htmlFor={`pf-m-${m}`} className="font-normal">
                    Flashforge {m}
                  </Label>
                </div>
              ))}
              {errors.compatible_models && <p className="text-xs text-destructive">{errors.compatible_models}</p>}
            </fieldset>
            <Field id="pf-slicer" label="Slicer">
              <Input id="pf-slicer" value={meta.slicer} onChange={(e) => set("slicer", e.target.value)} placeholder="Orca-Flashforge" />
            </Field>
            <Field id="pf-profile" label="Printer profile">
              <Input id="pf-profile" value={meta.printer_profile} onChange={(e) => set("printer_profile", e.target.value)} />
            </Field>
            <Field id="pf-material" label="Material">
              <Input id="pf-material" value={meta.material} onChange={(e) => set("material", e.target.value)} placeholder="PLA" />
            </Field>
            <Field id="pf-colour" label="Colour" hint="Hex (#FFFFFF) or name">
              <Input id="pf-colour" value={meta.colour} onChange={(e) => set("colour", e.target.value)} disabled={meta.multi_colour} />
            </Field>
            <Field id="pf-min" label="Estimated print time (minutes)" error={errors.estimated_minutes}>
              <Input id="pf-min" inputMode="numeric" value={meta.estimated_minutes} onChange={(e) => set("estimated_minutes", e.target.value)} />
            </Field>
            <Field id="pf-g" label="Estimated filament (g)" error={errors.estimated_grams}>
              <Input id="pf-g" inputMode="decimal" value={meta.estimated_grams} onChange={(e) => set("estimated_grams", e.target.value)} />
            </Field>
          </div>
          <div className="space-y-2 rounded-md border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Checkbox id="pf-multi" checked={meta.multi_colour} onCheckedChange={(v) => set("multi_colour", v === true)} />
              <Label htmlFor="pf-multi" className="font-normal">
                Multi-colour print
              </Label>
            </div>
            {meta.multi_colour && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Field id="pf-ch" label="Colours" error={errors.colour_channels}>
                    <Input
                      id="pf-ch"
                      inputMode="numeric"
                      className="w-20"
                      value={meta.colour_channels}
                      onChange={(e) => set("colour_channels", Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                    />
                  </Field>
                  <div className="flex items-center gap-2 pt-5">
                    <Checkbox id="pf-ifs" checked={meta.ifs_required} onCheckedChange={(v) => set("ifs_required", v === true)} />
                    <Label htmlFor="pf-ifs" className="font-normal">
                      Uses the AD5X IFS (material station)
                    </Label>
                  </div>
                </div>
                {errors.ifs_required && <p className="text-xs text-destructive">{errors.ifs_required}</p>}
                <div className="space-y-1.5">
                  {Array.from({ length: meta.colour_channels }, (_, i) => {
                    const a = meta.filament_assignments.find((x) => x.channel === i + 1) ?? { channel: i + 1, material: null, colour: null };
                    const update = (patch: Partial<FilamentAssignment>) =>
                      set("filament_assignments", [...meta.filament_assignments.filter((x) => x.channel !== i + 1), { ...a, ...patch }].sort((x, y) => x.channel - y.channel));
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-muted-foreground">Colour {i + 1}</span>
                        <Input aria-label={`Material ${i + 1}`} className="h-8 w-24" value={a.material ?? ""} onChange={(e) => update({ material: e.target.value || null })} placeholder="PLA" />
                        <Input aria-label={`Colour ${i + 1}`} className="h-8 w-28 font-mono" value={a.colour ?? ""} onChange={(e) => update({ colour: e.target.value || null })} placeholder="#FF0000" />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="pf-default" checked={meta.is_default} onCheckedChange={(v) => set("is_default", v === true)} disabled={!meta.product_id} />
            <Label htmlFor="pf-default" className="font-normal">
              Default file for this product (per printer model)
            </Label>
          </div>
          <Field id="pf-notes" label="Notes">
            <Textarea id="pf-notes" rows={2} value={meta.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || (!existing && !picked)}>
            {busy && <Loader2Icon className="animate-spin" />}
            {uploading ? "Uploading…" : existing ? "Save" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

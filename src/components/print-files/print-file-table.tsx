import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { Swatch } from "@/components/printers/telemetry-bits";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatGrams, formatShortDateTime } from "@/lib/domain/dates";
import type { PrintFileRow } from "@/lib/services/print-files";
import { cn } from "@/lib/utils";
import type { ProductChoice } from "./print-file-form";
import { PrintFileRowActions } from "./print-file-row-actions";

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PrintFileTable({
  files,
  orgId,
  products,
  canManage,
  timeZone,
  highlight,
  showProduct = true,
}: {
  files: PrintFileRow[];
  orgId: string;
  products: ProductChoice[];
  canManage: boolean;
  timeZone: string;
  highlight?: string | null;
  showProduct?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          {showProduct && <TableHead className="hidden md:table-cell">Product</TableHead>}
          <TableHead>Sliced for</TableHead>
          <TableHead className="hidden lg:table-cell">Filament</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Estimate</TableHead>
          <TableHead className="hidden xl:table-cell">Added</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((f) => (
          <TableRow key={f.id} className={cn(highlight === f.id && "bg-primary/5", f.archived_at && "opacity-60")}>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5 font-medium">
                {f.name}
                {f.verified_at && (
                  <Badge tone="green" title="Printed successfully in PrintFlow">
                    <CheckCircle2Icon /> Proven
                  </Badge>
                )}
                {f.is_default && <Badge tone="blue">Default</Badge>}
                {f.archived_at && <Badge tone="outline">Archived</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {f.file_name} · {f.file_type.toUpperCase()} · {size(f.size_bytes)}
                {f.slicer && ` · ${f.slicer}${f.slicer_version ? ` ${f.slicer_version}` : ""}`}
              </div>
            </TableCell>
            {showProduct && (
              <TableCell className="hidden md:table-cell">
                {f.product ? (
                  <Link href={`/products/${f.product.id}`} className="hover:underline">
                    {f.product.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            )}
            <TableCell>
              <span className="flex flex-wrap gap-1">
                {f.compatible_models.map((m) => (
                  <Badge key={m} tone="outline">
                    {m}
                  </Badge>
                ))}
              </span>
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              {f.multi_colour ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {f.filament_assignments.map((a) => (
                    <Swatch key={a.channel} colour={a.colour} />
                  ))}
                  <span className="text-xs">
                    {f.colour_channels} colours{f.ifs_required ? " · IFS" : ""}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  {f.colour && <Swatch colour={f.colour} />}
                  {[f.material, f.colour].filter(Boolean).join(" ") || "—"}
                </span>
              )}
            </TableCell>
            <TableCell className="tabular hidden text-right text-xs sm:table-cell">
              {f.estimated_minutes != null ? formatDuration(f.estimated_minutes) : "—"}
              <div className="text-muted-foreground">{f.estimated_grams != null ? formatGrams(f.estimated_grams) : ""}</div>
            </TableCell>
            <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">{formatShortDateTime(f.created_at, timeZone)}</TableCell>
            <TableCell>
              <PrintFileRowActions file={f} orgId={orgId} products={products} canManage={canManage} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

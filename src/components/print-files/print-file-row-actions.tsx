"use client";

import { ArchiveIcon, BadgeCheckIcon, DownloadIcon, MoreHorizontalIcon, RotateCcwIcon } from "lucide-react";
import { archivePrintFileAction, printFileDownloadAction, setPrintFileProvenAction } from "@/actions/print-files";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAction } from "@/hooks/use-action";
import type { PrintFile } from "@/types/db";
import { PrintFileDialog, type ProductChoice } from "./print-file-form";

export function PrintFileRowActions({ file, orgId, products, canManage }: { file: PrintFile; orgId: string; products: ProductChoice[]; canManage: boolean }) {
  const { pending, execute } = useAction();
  return (
    <div className="flex items-center justify-end gap-1">
      {canManage && !file.archived_at && <PrintFileDialog orgId={orgId} products={products} file={file} trigger={<Button size="sm" variant="outline">Edit</Button>} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${file.name}`} disabled={pending}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              execute(() => printFileDownloadAction(file.id), {
                success: "",
                onSuccess: (url) => {
                  window.location.href = url;
                },
              })
            }
          >
            <DownloadIcon /> Download
          </DropdownMenuItem>
          {canManage && (
            <DropdownMenuItem onSelect={() => execute(() => setPrintFileProvenAction(file.id, !file.verified_at))}>
              <BadgeCheckIcon /> {file.verified_at ? "Unmark proven" : "Mark proven"}
            </DropdownMenuItem>
          )}
          {canManage && (
            <DropdownMenuItem onSelect={() => execute(() => archivePrintFileAction(file.id, !file.archived_at))}>
              {file.archived_at ? <RotateCcwIcon /> : <ArchiveIcon />} {file.archived_at ? "Restore" : "Archive"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

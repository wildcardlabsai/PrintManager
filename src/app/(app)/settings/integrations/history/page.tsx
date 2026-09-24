import type { Metadata } from "next";
import { HistoryIcon } from "lucide-react";
import { OPERATION_LABELS, SYNC_STATUS_META } from "@/components/integrations/labels";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkTabs } from "@/components/shared/link-tabs";
import { PageBody } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatShortDateTime } from "@/lib/domain/dates";
import { PROVIDER_NAMES } from "@/lib/integrations/registry";
import { requirePageContext } from "@/lib/services/context";
import { listSyncLogs } from "@/lib/services/integrations/connections";

export const metadata: Metadata = { title: "Sync history" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "etsy", label: "Etsy" },
  { key: "ebay", label: "eBay" },
  { key: "royal_mail_click_drop", label: "Royal Mail" },
];

export default async function SyncHistoryPage({ searchParams }: PageProps<"/settings/integrations/history">) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const provider = FILTERS.some((f) => f.key && f.key === sp.provider) ? (sp.provider as string) : "";
  const result = await listSyncLogs(ctx, { page: Number(sp.page) || 1, provider: provider || null });
  const tz = ctx.settings.timezone;
  return (
    <PageBody>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-3 pt-1">
          <LinkTabs active={provider} tabs={FILTERS.map((f) => ({ key: f.key, label: f.label, href: f.key ? `/settings/integrations/history?provider=${f.key}` : "/settings/integrations/history" }))} />
        </div>
        {result.rows.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="No sync activity yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Integration</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Processed</TableHead>
                <TableHead className="hidden text-right md:table-cell">Created</TableHead>
                <TableHead className="hidden text-right md:table-cell">Updated</TableHead>
                <TableHead className="hidden text-right md:table-cell">Skipped</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="hidden lg:table-cell">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((l) => {
                const ms = l.completed_at ? Date.parse(l.completed_at) - Date.parse(l.started_at) : null;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-muted-foreground">
                      {formatShortDateTime(l.started_at, tz)}
                      <div className="text-xs">{ms != null ? (ms < 60000 ? `${Math.max(0.1, ms / 1000).toFixed(1)}s` : formatDuration(ms / 60000)) : "running"}</div>
                    </TableCell>
                    <TableCell>{PROVIDER_NAMES[l.provider as keyof typeof PROVIDER_NAMES] ?? l.provider}</TableCell>
                    <TableCell>
                      {OPERATION_LABELS[l.operation] ?? l.operation}
                      <div className="text-xs text-muted-foreground">{l.trigger === "manual" ? l.initiated_by_name ?? "Manual" : l.trigger}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge meta={SYNC_STATUS_META[l.status]} />
                    </TableCell>
                    <TableCell className="tabular text-right">{l.records_processed}</TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{l.records_created}</TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{l.records_updated}</TableCell>
                    <TableCell className="tabular hidden text-right md:table-cell">{l.records_skipped}</TableCell>
                    <TableCell className="tabular text-right">{l.error_count}</TableCell>
                    <TableCell className="hidden max-w-sm whitespace-normal text-xs text-red-700 lg:table-cell">{l.error_message ?? ""}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination {...result} basePath="/settings/integrations/history" params={sp} noun="entries" />
      </div>
    </PageBody>
  );
}

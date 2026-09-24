import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobActions } from "@/components/production/job-actions";
import { JobEditForm } from "@/components/production/job-edit-form";
import { JobProgress } from "@/components/production/job-progress";
import { DetailList } from "@/components/shared/detail-list";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { DemoBadge, StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatGrams } from "@/lib/domain/dates";
import { JOB_STATUS_META, ORDER_STATUS_META, PRIORITY_META } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { requirePageContext } from "@/lib/services/context";
import { AppError } from "@/lib/services/errors";
import { listUsableFilaments } from "@/lib/services/filaments";
import { getJob, jobLabel } from "@/lib/services/production";
import { listPrinterOptions } from "@/lib/services/products";
import type { JobStatus } from "@/types/db";

export const metadata: Metadata = { title: "Production job" };

export default async function JobPage({ params }: PageProps<"/production/[id]">) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const [detail, printers, spools] = await Promise.all([
    getJob(ctx, id).catch((e) => {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    }),
    listPrinterOptions(ctx),
    listUsableFilaments(ctx),
  ]);
  const { job: j, filament, usage, history } = detail;
  const tz = ctx.settings.timezone;
  const active = j.status === "printing" || j.status === "paused";

  return (
    <>
      <PageHeader
        back={{ href: "/production", label: "Production" }}
        title={`${j.product_name} × ${j.quantity}`}
        meta={
          <>
            <span className="font-mono text-xs text-muted-foreground">{jobLabel(j)}</span>
            <StatusBadge meta={JOB_STATUS_META[j.status]} />
            <StatusBadge meta={PRIORITY_META[j.priority]} />
            {j.is_demo && <DemoBadge />}
          </>
        }
        actions={<JobActions job={j} printers={printers} spools={spools} />}
      />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {active && (
              <Card>
                <CardContent className="space-y-2">
                  <div className="text-sm font-medium">On {j.printer?.name ?? "an unassigned printer"}</div>
                  <JobProgress job={j} />
                  <p className="text-xs text-muted-foreground">
                    Time since you pressed Start (excluding pauses). Live printer progress is coming in Phase 3.
                  </p>
                </CardContent>
              </Card>
            )}
            {j.status === "failed" && j.failure_reason && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <strong>Failed:</strong> {j.failure_reason}
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Job details</CardTitle>
              </CardHeader>
              <CardContent>
                <JobEditForm job={j} printers={printers} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Filament usage</CardTitle>
              </CardHeader>
              <CardContent>
                {usage.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No filament deducted yet. Usage is recorded when the job is completed (or when a failed print&apos;s waste is logged).
                  </p>
                ) : (
                  <ul className="divide-y text-[13px]">
                    {usage.map((u) => (
                      <li key={u.id} className="flex justify-between py-1.5">
                        <span>
                          {formatGrams(u.grams)} {u.note && <span className="text-muted-foreground">· {u.note}</span>}
                        </span>
                        <span className="tabular text-muted-foreground">
                          {formatMoney(u.cost, ctx.settings.currency)} · {formatDateTime(u.created_at, tz)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    [
                      "Order",
                      j.order ? (
                        <Link href={`/orders/${j.order.id}`} className="text-primary hover:underline">
                          {j.order.order_number} · {ORDER_STATUS_META[j.order.status].label}
                        </Link>
                      ) : (
                        "—"
                      ),
                    ],
                    ["Customer", j.order?.customer_name ?? "—"],
                    ["Printer", j.printer?.name ?? "Unassigned"],
                    ["Material", [j.material, j.colour].filter(Boolean).join(" · ") || "—"],
                    ["Estimated time", formatDuration(j.estimated_minutes)],
                    ["Actual time", formatDuration(j.actual_minutes)],
                    ["Estimated filament", formatGrams(j.estimated_grams)],
                    ["Actual filament", formatGrams(j.actual_grams)],
                    ["Spool", filament ? `${filament.brand} ${filament.material} ${filament.colour}` : "—"],
                    ["Attempts", j.attempts],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Timestamps</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    ["Created", formatDateTime(j.created_at, tz)],
                    ["Started", formatDateTime(j.started_at, tz)],
                    ["Completed", formatDateTime(j.completed_at, tz)],
                    ...(j.failed_at ? ([["Failed", formatDateTime(j.failed_at, tz)]] as [string, string][]) : []),
                    ["Updated", formatDateTime(j.updated_at, tz)],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-[13px]">
                  {history.map((h) => (
                    <li key={h.id}>
                      <div>
                        {h.from_status ? `${JOB_STATUS_META[h.from_status as JobStatus]?.label ?? h.from_status} → ` : "Created · "}
                        <strong>{JOB_STATUS_META[h.to_status as JobStatus]?.label ?? h.to_status}</strong>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(h.created_at, tz)} · {h.changed_by_name ?? "System"}
                        {h.note && ` · ${h.note}`}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

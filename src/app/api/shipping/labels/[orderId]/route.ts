import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/services/errors";
import { loadAppContext } from "@/lib/services/context";
import { getLabelPdf } from "@/lib/services/integrations/labels";

/** Label PDF download for members of the order's business. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/shipping/labels/[orderId]">) {
  const { orderId } = await params;
  const ctx = await loadAppContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { pdf, filename } = await getLabelPdf(ctx, orderId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const status = e instanceof AppError && e.code === "not_found" ? 404 : 400;
    return NextResponse.json({ error: e instanceof AppError ? e.message : "Label unavailable" }, { status });
  }
}

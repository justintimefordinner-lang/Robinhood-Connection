// Polled by AmRefreshButton to learn whether a queued am_report refresh is
// still pending, and to detect completion (report's meta.asOf moves past the
// request's requestedAt). Mirrors /api/status for the snapshot flow.
import { getAmReport, isAmRefreshPending } from "@/lib/am-report";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = getAmReport();
  return Response.json({
    pending: isAmRefreshPending(),
    asOf: report?.meta.asOf ?? null,
  });
}

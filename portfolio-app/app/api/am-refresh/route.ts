// Queues a forced am_report refresh. Mirrors the snapshot refresh flow in
// /api/refresh: the web app cannot call the Robinhood MCP connector itself, so
// this just writes data/am-refresh-request.json with a fresh requestedAt.
// Claude Code (see REFRESH.md) notices the pending request, re-runs the
// am_report engine (regime + CSP board + ladder), rewrites data/am_report.json,
// and deletes the request file.
import fs from "node:fs";
import path from "node:path";
import { AM_REQUEST_PATH } from "@/lib/am-report";

export const dynamic = "force-dynamic";

export async function POST() {
  fs.mkdirSync(path.dirname(AM_REQUEST_PATH), { recursive: true });
  fs.writeFileSync(AM_REQUEST_PATH, JSON.stringify({ requestedAt: new Date().toISOString() }));
  return Response.json({ ok: true });
}

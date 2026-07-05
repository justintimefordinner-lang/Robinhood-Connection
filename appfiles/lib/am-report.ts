// Server-side loader for the AM report (data/am_report.json, written by the Python
// am_report engine). Import only from server components. Returns null when the file
// is absent so the page can show a "run am_report.py" hint instead of crashing.
import fs from "node:fs";
import path from "node:path";
import type { AmReport } from "./am-report-types";

export const AM_REPORT_PATH = path.join(process.cwd(), "data", "am_report.json");
export const AM_REQUEST_PATH = path.join(process.cwd(), "data", "am-refresh-request.json");

export function getAmReport(): AmReport | null {
  try {
    const raw = fs.readFileSync(AM_REPORT_PATH, "utf8");
    const parsed = JSON.parse(raw) as AmReport;
    if (Array.isArray(parsed?.board)) return parsed;
  } catch {
    // missing or malformed
  }
  return null;
}

export interface AmRefreshRequest {
  requestedAt: string;
}

export function readAmRequest(): AmRefreshRequest | null {
  try {
    return JSON.parse(fs.readFileSync(AM_REQUEST_PATH, "utf8")) as AmRefreshRequest;
  } catch {
    return null;
  }
}

/** A refresh is pending when a request exists that is newer than the report. */
export function isAmRefreshPending(): boolean {
  const req = readAmRequest();
  if (!req) return false;
  const report = getAmReport();
  if (!report) return true;
  return new Date(req.requestedAt).getTime() > new Date(report.meta.asOf).getTime();
}

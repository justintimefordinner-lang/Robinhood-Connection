import fs from "fs";
import path from "path";

// Per-feed last/next refresh times, written by auto_push (the scheduler) to
// data/refresh-status.json. Keys: "app" (snapshot + vix), "research", "am_report",
// "am_ladder", "history". The app reads it to count down to the next refresh, and
// to show when the last attempt actually failed rather than just going quiet.
export interface FeedStatus {
  lastAt?: string; // last time this feed's data actually changed (only moves on success)
  lastAttemptAt?: string; // last time a run was attempted at all, success or not
  nextAt?: string;
  intervalSec?: number;
  status?: "ok" | "error";
  error?: string; // present when status === "error"
}
export type RefreshStatus = Record<string, FeedStatus>;

export const REFRESH_STATUS_PATH = path.join(process.cwd(), "data", "refresh-status.json");

export function getRefreshStatus(): RefreshStatus {
  try {
    const raw = fs.readFileSync(REFRESH_STATUS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as RefreshStatus) : {};
  } catch {
    return {};
  }
}

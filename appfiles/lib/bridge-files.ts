// Write-only bridge deposits + one-way status read.
//
// The security contract for the Robinhood connection: this app DEPOSITS things
// into the bridge folder and NEVER reads the bridge's secret files back.
//   * credentials.env         — Robinhood sign-in, written WHOLESALE (never read/merged)
//   * reauth_inbox/reconnect  — empty marker: "make one fresh login attempt now"
//
// The only thing the app reads is its OWN data/ folder, where the bridge writes
// a sanitized robinhood-auth.json status (no secrets). See reauth.py on the bridge.
import fs from "node:fs";
import path from "node:path";
import { BRIDGE_DIR } from "@/lib/bridge-dir";
import type { BridgeInfo } from "@/lib/bridges";
import { writeEnvUpdates } from "@/lib/env-file";

// The app deposits into the bridge's OWN folder (credentials.env, .env,
// reauth_inbox/) and reads the sanitized status the bridge publishes into the
// app's data dir. The bridge's APP_DATA_DIR is exactly the folder holding its status.
function reauthPaths(b: BridgeInfo) {
  const inbox = path.join(b.dir, "reauth_inbox");
  return {
    credentials: path.join(b.dir, "credentials.env"),
    envFile: path.join(b.dir, ".env"),
    inbox,
    reconnect: path.join(inbox, "reconnect"),
    appDataDir: path.dirname(b.statusPath),
  };
}

function lockDown(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort — not all filesystems support POSIX perms
  }
}

// A value goes on one KEY=value line, so it can't carry a line break.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, "");

/**
 * WHOLESALE-write the Robinhood sign-in into credentials.env. This truncates and
 * replaces the file; it never reads existing contents, so there is no read path
 * to the password and no stale value can linger when it changes. Because the app
 * owns 100% of this file, wholesale write is safe. The authenticator secret is
 * optional — without it Robinhood sends an approval prompt to the phone instead.
 */
export function writeCredentials(bridge: BridgeInfo, username: string, password: string, totpSecret?: string): void {
  const p = reauthPaths(bridge);
  const totp = oneLine(totpSecret || "").replace(/\s+/g, "");
  const body =
    "# Written by the dashboard's Settings page. Do not edit by hand.\n" +
    "# Holds secrets — git-ignored, chmod 600.\n" +
    `ROBINHOOD_USERNAME=${oneLine(username).trim()}\n` +
    `ROBINHOOD_PASSWORD=${oneLine(password)}\n` +
    (totp ? `ROBINHOOD_TOTP_SECRET=${totp}\n` : "");
  fs.mkdirSync(bridge.dir, { recursive: true });
  fs.writeFileSync(p.credentials, body, { mode: 0o600 });
  lockDown(p.credentials);

  // Non-secret config the bridge needs so it writes data/status into the app's
  // data folder. This touches .env (config, not secrets) via the existing merge
  // helper — credentials themselves never go here.
  writeEnvUpdates(p.envFile, { APP_DATA_DIR: p.appDataDir });
}

/** Drop the "make one login attempt now" marker for the bridge. Write-only. */
export function requestReconnect(bridge: BridgeInfo): void {
  const p = reauthPaths(bridge);
  fs.mkdirSync(p.inbox, { recursive: true });
  fs.writeFileSync(p.reconnect, "");
}

export interface RobinhoodAuthStatus {
  configured: boolean; // a username + password are on file
  username: string | null; // masked by the bridge ("ju•••@gmail.com")
  hasTotp: boolean;
  hasSession: boolean; // a saved Robinhood session exists
  authStatus: "needs_setup" | "needs_login" | "connecting" | "connected" | "error";
  manualRequired: boolean; // automatic retries are paused until Reconnect is pressed
  lockedUntil: string | null; // time-based cooldown, when one applies
  consecutiveFailures: number;
  lastAttemptAt: string | null;
  lastErrorType: "rate_limited" | "auth_failed" | "unknown" | null;
  error: string | null;
  updatedAt: string | null;
}

/**
 * Read the bridge-authored status from the app's OWN data/ folder. Never reads
 * the bridge's secret files. Missing file => treat as un-configured.
 */
export function readAuthStatus(bridge: BridgeInfo): RobinhoodAuthStatus {
  const fallback: RobinhoodAuthStatus = {
    configured: false,
    username: null,
    hasTotp: false,
    hasSession: false,
    authStatus: "needs_setup",
    manualRequired: false,
    lockedUntil: null,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastErrorType: null,
    error: null,
    updatedAt: null,
  };
  try {
    const raw = fs.readFileSync(bridge.statusPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RobinhoodAuthStatus>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

// ── Trade-history backfill: write-only trigger + one-way status read ──
const TASK_INBOX_DIR = path.join(BRIDGE_DIR, "task_inbox");
const BACKFILL_MARKER = path.join(TASK_INBOX_DIR, "backfill_history");
const HISTORY_STATUS_PATH = path.join(process.cwd(), "data", "history-status.json");

/** Drop the "rebuild full trade history" marker for the bridge. Write-only. */
export function requestHistoryBackfill(): void {
  fs.mkdirSync(TASK_INBOX_DIR, { recursive: true });
  fs.writeFileSync(BACKFILL_MARKER, "");
}

export interface HistoryStatus {
  status: "idle" | "running" | "done" | "error";
  counts: Record<string, number> | null;
  error: string | null;
  updatedAt: string | null;
}

/** Read the bridge-written backfill status from the app's OWN data/ folder. */
export function readHistoryStatus(): HistoryStatus {
  const fallback: HistoryStatus = { status: "idle", counts: null, error: null, updatedAt: null };
  try {
    const raw = fs.readFileSync(HISTORY_STATUS_PATH, "utf8");
    return { ...fallback, ...(JSON.parse(raw) as Partial<HistoryStatus>) };
  } catch {
    return fallback;
  }
}

// ── Morning Brief refresh: write-only trigger + one-way status read ──
const REPORT_REFRESH_MARKER = path.join(TASK_INBOX_DIR, "refresh_report");
const REPORT_STATUS_PATH = path.join(process.cwd(), "data", "report-status.json");

/** Drop the "rebuild the morning brief now" marker for the bridge. Write-only. */
export function requestReportRefresh(): void {
  fs.mkdirSync(TASK_INBOX_DIR, { recursive: true });
  fs.writeFileSync(REPORT_REFRESH_MARKER, "");
}

export interface ReportStatus {
  status: "idle" | "running" | "done" | "error";
  error: string | null;
  updatedAt: string | null;
}

/** Read the bridge-written report-refresh status from the app's OWN data/ folder. */
export function readReportStatus(): ReportStatus {
  const fallback: ReportStatus = { status: "idle", error: null, updatedAt: null };
  try {
    const raw = fs.readFileSync(REPORT_STATUS_PATH, "utf8");
    return { ...fallback, ...(JSON.parse(raw) as Partial<ReportStatus>) };
  } catch {
    return fallback;
  }
}

// ── Manual cost basis for stock sales whose purchase predates the data window ──
// These two files live in the app's OWN data/ folder (the shared diode): the bridge
// writes stocks-unresolved.json, the app writes manual_cost_basis.json (not a secret,
// so a read-merge is fine), and the bridge reads it back on its next rebuild.
const UNRESOLVED_PATH = path.join(process.cwd(), "data", "stocks-unresolved.json");
const MANUAL_BASIS_PATH = path.join(process.cwd(), "data", "manual_cost_basis.json");
const MANUAL_SALES_PATH = path.join(process.cwd(), "data", "manual_stock_sales.json");

export interface UnresolvedStock {
  id: string;
  symbol: string;
  side: "long" | "short";
  shares: number;
  soldAt: number;
  closeDate: string;
  costPerShare?: number | null; // pre-filled when a basis was already entered (just needs a date)
  acquiredDate?: string | null; // ISO date; when missing the sale can't be short/long-term classified
}

export function readUnresolvedStocks(): UnresolvedStock[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(UNRESOLVED_PATH, "utf8")) as { unresolved?: UnresolvedStock[] };
    return Array.isArray(parsed.unresolved) ? parsed.unresolved : [];
  } catch {
    return [];
  }
}

/** Merge one user-entered cost basis (and optional acquired date) into
 * manual_cost_basis.json. Read-merge is fine here — it's the user's own input, not
 * a bridge secret. acquiredDate sets the holding period so the bridge can classify
 * the sale as short- vs long-term. */
export function saveManualCostBasis(id: string, costPerShare: number, acquiredDate?: string | null): void {
  let cur: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(MANUAL_BASIS_PATH, "utf8"));
    if (parsed && typeof parsed === "object") cur = parsed as Record<string, unknown>;
  } catch {
    cur = {};
  }
  const acq = (acquiredDate || "").trim();
  cur[id] = acq ? { costPerShare, acquiredDate: acq } : { costPerShare };
  fs.mkdirSync(path.dirname(MANUAL_BASIS_PATH), { recursive: true });
  fs.writeFileSync(MANUAL_BASIS_PATH, JSON.stringify(cur, null, 2));
}

// ── Fully user-added closed stock sales (predate the feed entirely, so they never
//    surface as orphans). Stored as a list the bridge reads on rebuild. ──
export interface ManualStockSale {
  id: string;
  symbol: string;
  shares: number;
  proceedsPerShare: number;
  costPerShare: number;
  acquiredDate: string; // ISO
  soldDate: string; // ISO
}

export function readManualStockSales(): ManualStockSale[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANUAL_SALES_PATH, "utf8"));
    return Array.isArray(parsed) ? (parsed as ManualStockSale[]) : [];
  } catch {
    return [];
  }
}

function writeManualStockSales(list: ManualStockSale[]): void {
  fs.mkdirSync(path.dirname(MANUAL_SALES_PATH), { recursive: true });
  fs.writeFileSync(MANUAL_SALES_PATH, JSON.stringify(list, null, 2));
}

/** Append a user-added closed stock sale; returns the stored row (with its id). */
export function addManualStockSale(sale: Omit<ManualStockSale, "id">): ManualStockSale {
  const list = readManualStockSales();
  const row: ManualStockSale = { ...sale, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` };
  list.push(row);
  writeManualStockSales(list);
  return row;
}

/** Remove a user-added sale by id. */
export function deleteManualStockSale(id: string): void {
  writeManualStockSales(readManualStockSales().filter((s) => s.id !== id));
}

// Multi-account (multi-login) data resolution.
//
// Each additional Schwab login runs its OWN bridge that points APP_DATA_DIR at a
// SUBDIRECTORY of the app's data/ (e.g. data/acct2/) and writes its normal output
// file set there. These helpers let the account-specific loaders merge across the
// base data/ dir plus every such subdirectory, so the account switcher spans all
// logins with no per-file config. Market/universe files (am_report, vix, research,
// earnings) deliberately stay single-source and are read from the base dir only.
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");

/** The base data dir plus each immediate subdirectory (one per extra-login bridge). */
export function dataDirs(): string[] {
  const dirs = [DATA_DIR];
  try {
    for (const e of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(path.join(DATA_DIR, e.name));
    }
  } catch {
    // no data dir yet — just the base path (which itself may be absent)
  }
  return dirs;
}

/** Parse `name` from every data dir that has it (base dir first). Missing/bad files
 *  are skipped, so the result is however many bridges have written that file. */
export function readAllJson<T>(name: string): T[] {
  const out: T[] = [];
  for (const dir of dataDirs()) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as T);
    } catch {
      // absent or malformed in this dir — skip
    }
  }
  return out;
}

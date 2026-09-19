// Server-side loader for the ticker → sector map (data/sectors.json, written by
// the bridge's sectors.py from Yahoo Finance). Import only from server components
// and route handlers (it touches the filesystem).
//
// Every bridge writes its own copy next to its snapshot, so the map is merged
// across the base data/ dir and each extra-login subdirectory, the same way
// snapshots are. `overrides` from any file win over looked-up values, so a hand
// correction in one place applies everywhere.
import type { SectorMap, SectorsFile } from "./types";
import { isExampleMode } from "./example-mode";
import { exampleSectors } from "./example";
import { readAllJson } from "./data-dirs";

/** Pure merge: looked-up sectors first (later files fill gaps, never replace a
 *  classified name), then overrides from every file on top. */
export function resolveSectorMap(files: SectorsFile[]): SectorMap {
  const map: SectorMap = {};
  for (const f of files) {
    for (const [sym, entry] of Object.entries(f?.tickers ?? {})) {
      const key = sym.toUpperCase();
      if (entry?.sector && !map[key]) map[key] = entry.sector;
    }
  }
  for (const f of files) {
    for (const [sym, sector] of Object.entries(f?.overrides ?? {})) {
      if (typeof sector === "string" && sector.trim()) map[sym.toUpperCase()] = sector.trim();
    }
  }
  return map;
}

export async function getSectorMap(): Promise<SectorMap> {
  if (await isExampleMode()) return resolveSectorMap([exampleSectors]);
  return resolveSectorMap(readAllJson<SectorsFile>("sectors.json"));
}

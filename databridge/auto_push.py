"""
auto_push.py  (Robinhood bridge)
==================================

Long-running loop that keeps the app's data files fresh from Robinhood +
public market data. Mirrors schwab-bridge's auto_push.py scope:

  - app        -> export_to_app.main()      (snapshot.json / value-history.json)
  - research   -> research_sync.main()      (research.json)
  - am_report  -> am_report.main()          (am_report.json - Morning Brief)
  - am_ladder  -> am_report.refresh_ladders (light intraday put-premium refresh)

NOT included here, by design: sync_trade_history.py. It pulls your ENTIRE
order history each run (see its docstring) - fine once a day, wasteful and
slower every 60 seconds. Run it via cron/systemd-timer on a daily cadence
instead (e.g. after the close):

    0 16 * * 1-5  cd /path/to/databridge && ./.venv/bin/python sync_trade_history.py

Run with:
    python auto_push.py

Stop with Ctrl+C, or manage as a systemd service (see ../systemd/).

.env knobs (all optional):
    APP_PUSH_INTERVAL=60         # seconds between app pushes    (0 = disable)
    RESEARCH_PUSH_INTERVAL=900   # seconds between research pushes
    AM_REPORT_PUSH_INTERVAL=1800 # seconds between full Morning Brief rebuilds
    AM_LADDER_PUSH_INTERVAL=300  # seconds between light put-ladder refreshes

Read-only throughout - this never places or cancels an order.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

TICK_SECONDS = 5


def _log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _interval(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _run(label: str, fn) -> tuple[float, object, str, str | None]:
    """Returns (elapsed, result, outcome, message).
    outcome is one of "ok" / "skipped" / "error". "skipped" (a deliberate
    SystemExit, e.g. "Market closed - skipping ladder refresh") is NOT the
    same as a failure - it's expected, routine behavior - so it must not be
    surfaced to the user as an error. Only a genuine exception counts as
    "error"."""
    start = time.time()
    result = None
    outcome = "error"
    message = None
    try:
        result = fn()
        outcome = "ok"
        _log(f"{label}: ok ({time.time() - start:.1f}s)")
    except SystemExit as exc:
        outcome = "skipped"
        message = str(exc)
        _log(f"{label}: skipped - {exc}")
    except Exception as exc:  # e.g. session expired, needs re-login
        message = str(exc)
        _log(f"{label}: ERROR - {exc}")
    return time.time() - start, result, outcome, message


_ENV_KEY_FOR_LABEL = {
    "app": "APP_PUSH_INTERVAL",
    "research": "RESEARCH_PUSH_INTERVAL",
    "am_report": "AM_REPORT_PUSH_INTERVAL",
    "am_ladder": "AM_LADDER_PUSH_INTERVAL",
}


def _reload_intervals(targets: list[list]) -> None:
    """Re-read *_PUSH_INTERVAL from .env and apply any change to already-
    running targets, so interval edits made via the app's Settings page take
    effect without restarting this process (auto_push.py is meant to run for
    days at a time under systemd/pm2 — requiring a restart for a cadence
    tweak would defeat the point of exposing it as a live setting).

    Only adjusts targets that were already enabled at startup (interval > 0
    in the targets list built in main()). Flipping a target from disabled to
    enabled — or the reverse — still needs a restart, since a disabled
    target's module was never imported and isn't in `targets` to begin with.
    A changed interval takes effect starting with that target's *next*
    scheduled run, not immediately, since we intentionally leave next_run
    alone here rather than forcing an early re-run just because the interval
    changed."""
    load_dotenv(override=True)
    for t in targets:
        label = t[0]
        env_key = _ENV_KEY_FOR_LABEL.get(label)
        if not env_key:
            continue
        new_interval = _interval(env_key, t[2])
        if new_interval > 0 and new_interval != t[2]:
            _log(f"{label}: interval changed {t[2]}s -> {new_interval}s (picked up from .env)")
            t[2] = new_interval


import json

_REFRESH_STATUS: dict[str, dict] = {}


def _refresh_status_data_dir() -> str | None:
    """Resolve appfiles/data the same way export_to_app.py does (APP_DATA_DIR
    in .env), without duplicating that validation logic here. Returns None if
    it's unset/misconfigured - the writer below just no-ops in that case
    rather than crashing the whole loop over a display-only feature."""
    try:
        import export_to_app

        return export_to_app._app_data_dir()
    except Exception:
        return None


def _write_refresh_status(label: str, interval: int, next_run: float, outcome: str, message: str | None) -> None:
    """Persist last/next run time - and now last attempt + failure state -
    for one target to appfiles/data/refresh-status.json, which the
    frontend's DataRefresh component reads via lib/refresh-status.ts.

    Previously this only recorded lastAt on success and stayed silent on
    failure, which meant a stuck feed just looked "a bit stale" instead of
    visibly broken. Now every run - success, failure, or skip - stamps
    lastAttemptAt, and a real failure also sets status="error" plus the
    error message, so the frontend can show "failed 4m ago" instead of
    quietly doing nothing.

    outcome handling:
      "ok"      -> lastAt AND lastAttemptAt both move forward; status="ok";
                   any previous error is cleared.
      "error"   -> only lastAttemptAt moves forward (lastAt stays at the last
                   time real data actually changed); status="error" with the
                   message attached.
      "skipped" -> only lastAttemptAt moves forward; status/error are left
                   exactly as they were. A deliberate skip (e.g. "market
                   closed") is not a failure and must not clear a genuine
                   prior error, but also isn't itself something to warn
                   about.

    Best effort throughout: any failure here must never take down the main
    loop, since this is a nice-to-have display, not core functionality.
    """
    entry = _REFRESH_STATUS.setdefault(label, {})
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    entry["lastAttemptAt"] = now_iso

    if outcome == "ok":
        entry["lastAt"] = now_iso
        entry["status"] = "ok"
        entry.pop("error", None)
    elif outcome == "error":
        entry["status"] = "error"
        entry["error"] = (message or "Unknown error")[:300]

    entry["nextAt"] = datetime.fromtimestamp(next_run, tz=timezone.utc).isoformat(timespec="seconds")
    entry["intervalSec"] = interval

    data_dir = _refresh_status_data_dir()
    if not data_dir:
        return
    path = os.path.join(data_dir, "refresh-status.json")
    tmp_path = path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(_REFRESH_STATUS, f)
        os.replace(tmp_path, path)  # atomic on POSIX - readers never see a partial write
    except OSError as exc:
        _log(f"refresh-status: couldn't write {path}: {exc}")


def main() -> None:
    app_interval = _interval("APP_PUSH_INTERVAL", 60)
    research_interval = _interval("RESEARCH_PUSH_INTERVAL", 900)
    am_report_interval = _interval("AM_REPORT_PUSH_INTERVAL", 1800)
    am_ladder_interval = _interval("AM_LADDER_PUSH_INTERVAL", 300)

    targets: list[list] = []
    if app_interval > 0:
        import export_to_app
        targets.append(["app", export_to_app.main, app_interval, 0.0])
    if research_interval > 0:
        import research_sync
        targets.append(["research", research_sync.main, research_interval, 0.0])
    if am_report_interval > 0:
        import am_report
        targets.append(["am_report", am_report.main, am_report_interval, 0.0])
    if am_ladder_interval > 0:
        import am_report as _amr
        targets.append(["am_ladder", _amr.refresh_ladders, am_ladder_interval, 0.0])

    if not targets:
        raise SystemExit("Nothing to push. Set at least one *_PUSH_INTERVAL > 0.")

    _log(
        "auto_push started - "
        + ", ".join(f"{t[0]} every {t[2]}s" for t in targets)
        + ". Press Ctrl+C to stop."
    )
    try:
        while True:
            now = time.time()
            _reload_intervals(targets)
            for t in targets:
                label, fn, interval, next_run = t
                if now >= next_run:
                    elapsed, result, outcome, message = _run(label, fn)
                    if elapsed > interval:
                        _log(
                            f"{label}: warning - took {elapsed:.0f}s, longer than its "
                            f"{interval}s interval; this target is slipping behind"
                        )
                    if label == "am_ladder" and isinstance(result, int) and result > 0:
                        used = result
                    else:
                        used = interval
                    t[3] = time.time() + used
                    _write_refresh_status(label, interval, t[3], outcome, message)
            time.sleep(TICK_SECONDS)
    except KeyboardInterrupt:
        _log("Stopped.")


if __name__ == "__main__":
    main()

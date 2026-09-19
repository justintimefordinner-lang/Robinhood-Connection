"""
auto_push.py  (Robinhood bridge)
==================================

Long-running loop that keeps the app's data files fresh from Robinhood +
public market data. Mirrors schwab-bridge's auto_push.py scope:

  - app        -> export_to_app.main()      (snapshot.json / value-history.json)
  - research   -> research_sync.main()      (research.json)
  - am_report  -> am_report.main()          (am_report.json - Morning Brief)
  - am_ladder  -> am_report.refresh_ladders (light intraday put-premium refresh)
  - manual     -> manual_positions.main()   (manual/snapshot.json - hand-entered positions)
  - history    -> sync_trade_history.main() (trade history + the closed tabs)
  - earnings   -> fetch_earnings.main()     (earnings.json)

history and earnings run ONCE A DAY. sync_trade_history pulls your ENTIRE order
history each run (see its docstring) - fine daily, wasteful every 60 seconds.
They used to be systemd timers / pm2 cron entries; a container has neither, so
they are scheduled here, and the last successful run is remembered across
restarts (refresh-status.json) so a new image doesn't re-pull everything.

Each tick also services what the dashboard asks for by dropping a marker file
(it can't run anything here itself): a Robinhood reconnect (reauth.py), a trade
history rebuild (backfill.py) and a Morning Brief refresh (report_refresh.py).

Run with:
    python auto_push.py

Stop with Ctrl+C. Runs as the `bridge` container in the release stack.

.env knobs (all optional):
    APP_PUSH_INTERVAL=60         # seconds between app pushes    (0 = disable)
    RESEARCH_PUSH_INTERVAL=900   # seconds between research pushes
    AM_REPORT_PUSH_INTERVAL=1800 # seconds between full Morning Brief rebuilds
    AM_LADDER_PUSH_INTERVAL=300  # seconds between light put-ladder refreshes
    MANUAL_PUSH_INTERVAL=300     # seconds between manual-position repricing
    HISTORY_PUSH_INTERVAL=86400  # seconds between trade-history syncs
    EARNINGS_PUSH_INTERVAL=86400 # seconds between earnings-date refreshes

Read-only throughout - this never places or cancels an order.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

TICK_SECONDS = 5
SLOW_RETRY_SECONDS = 900  # a failed once-a-day job tries again in 15 minutes


def _optional(name: str):
    """Import a module the loop can live without. A broken add-on must never
    stop the data feeds, so a failure is logged and the feature stays off."""
    try:
        return __import__(name)
    except Exception as exc:  # noqa: BLE001
        print(f"auto_push: {name} unavailable ({exc}); continuing without it", flush=True)
        return None


# Dashboard-facing add-ons: reconnect requests + login status, the Build history
# and Morning Brief refresh buttons, and pricing for hand-entered positions.
reauth = _optional("reauth")
backfill = _optional("backfill")
report_refresh = _optional("report_refresh")
manual_positions = _optional("manual_positions")


def _log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _interval(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _run(label: str, fn) -> tuple[float, object, str, str | None]:
    """Returns (elapsed, result, outcome, message).
    outcome is one of "ok" / "skipped" / "login_required" / "error".
      "skipped"        - a deliberate SystemExit (e.g. "Market closed -
                          skipping ladder refresh"). Expected, routine
                          behavior, not a failure.
      "login_required" - login_guard.LoginLocked: the guard is refusing to
                          auto-retry until a manual Reconnect happens. This
                          is a known, easily-fixed state (tap one button),
                          NOT the same as a real failure - it must not be
                          surfaced to the user looking like something is
                          broken.
      "error"           - a genuine unexpected exception.
    """
    import login_guard

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
    except login_guard.LoginLocked as exc:
        outcome = "login_required"
        message = str(exc)
        _log(f"{label}: login required - {exc}")
    except Exception as exc:  # e.g. a real API error, bad data, etc.
        message = str(exc)
        _log(f"{label}: ERROR - {exc}")
    return time.time() - start, result, outcome, message


_ENV_KEY_FOR_LABEL = {
    "app": "APP_PUSH_INTERVAL",
    "research": "RESEARCH_PUSH_INTERVAL",
    "am_report": "AM_REPORT_PUSH_INTERVAL",
    "am_ladder": "AM_LADDER_PUSH_INTERVAL",
    "history": "HISTORY_PUSH_INTERVAL",
    "earnings": "EARNINGS_PUSH_INTERVAL",
    "manual": "MANUAL_PUSH_INTERVAL",
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
      "ok"              -> lastAt AND lastAttemptAt both move forward;
                            status="ok"; any previous error is cleared.
      "login_required"  -> only lastAttemptAt moves forward; status=
                            "login_required" with the LoginLocked message
                            attached. This is a known, one-tap-fixable state
                            (Settings -> Reconnect Robinhood), NOT a real
                            failure - kept as a distinct status so the
                            frontend can show something calmer and more
                            actionable than a generic error badge.
      "error"           -> only lastAttemptAt moves forward (lastAt stays at
                            the last time real data actually changed);
                            status="error" with the message attached.
      "skipped"         -> only lastAttemptAt moves forward; status/error
                            are left exactly as they were. A deliberate skip
                            (e.g. "market closed") is not a failure and must
                            not clear a genuine prior error, but also isn't
                            itself something to warn about.

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
    elif outcome == "login_required":
        entry["status"] = "login_required"
        entry["error"] = (message or "Login required")[:300]
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


def _load_refresh_status() -> None:
    """Pick up the last run times a previous process recorded, so a restart (a
    new image, a reboot) doesn't forget that the once-a-day jobs already ran."""
    data_dir = _refresh_status_data_dir()
    if not data_dir:
        return
    try:
        with open(os.path.join(data_dir, "refresh-status.json"), encoding="utf-8") as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            _REFRESH_STATUS.update({k: v for k, v in saved.items() if isinstance(v, dict)})
    except (OSError, ValueError):
        pass


def _resume_at(label: str, interval: int) -> float:
    """When a slow target should next run, given when it last ran. Due now if
    it never has, or if its interval already elapsed while we were down - the
    catch-up behaviour the old systemd timers had with Persistent=true."""
    last = _REFRESH_STATUS.get(label, {}).get("lastAt")  # last SUCCESS, so a failed run is retried
    if not last:
        return 0.0
    try:
        return datetime.fromisoformat(last).timestamp() + interval
    except ValueError:
        return 0.0


def _fetch_earnings() -> None:
    import fetch_earnings

    fetch_earnings.main(["fetch_earnings"])


def main() -> None:
    app_interval = _interval("APP_PUSH_INTERVAL", 60)
    research_interval = _interval("RESEARCH_PUSH_INTERVAL", 900)
    am_report_interval = _interval("AM_REPORT_PUSH_INTERVAL", 1800)
    am_ladder_interval = _interval("AM_LADDER_PUSH_INTERVAL", 300)
    # Once a day. These two used to be systemd timers / pm2 cron entries; a
    # container has neither, so they live in this loop now.
    history_interval = _interval("HISTORY_PUSH_INTERVAL", 86400)
    earnings_interval = _interval("EARNINGS_PUSH_INTERVAL", 86400)
    # Every manual contract is its own Robinhood request, so this runs slower than
    # the snapshot by default (see manual_positions.py).
    manual_interval = _interval("MANUAL_PUSH_INTERVAL", max(app_interval, 300))

    _load_refresh_status()

    targets: list[list] = []
    if app_interval > 0:
        import export_to_app
        targets.append(["app", export_to_app.main, app_interval, 0.0])
    if manual_interval > 0 and manual_positions is not None:
        targets.append(["manual", manual_positions.main, manual_interval, 0.0])
    if research_interval > 0:
        import research_sync
        targets.append(["research", research_sync.main, research_interval, 0.0])
    if am_report_interval > 0:
        import am_report
        targets.append(["am_report", am_report.main, am_report_interval, 0.0])
    if am_ladder_interval > 0:
        import am_report as _amr
        targets.append(["am_ladder", _amr.refresh_ladders, am_ladder_interval, 0.0])
    if history_interval > 0:
        import sync_trade_history
        targets.append(["history", sync_trade_history.main, history_interval, _resume_at("history", history_interval)])
    if earnings_interval > 0:
        targets.append(["earnings", _fetch_earnings, earnings_interval, _resume_at("earnings", earnings_interval)])

    if not targets:
        raise SystemExit("Nothing to push. Set at least one *_PUSH_INTERVAL > 0.")

    if reauth is not None:
        reauth.init_status()

    _log(
        "auto_push started - "
        + ", ".join(f"{t[0]} every {t[2]}s" for t in targets)
        + ". Press Ctrl+C to stop."
    )
    try:
        while True:
            # Dashboard requests first. Each is one os.path.exists when idle.
            if reauth is not None:
                try:
                    if reauth.process_inbox():
                        # Signed in again: refresh the fast feeds now rather than
                        # leaving "Login needed" on screen until their timers lapse.
                        for t in targets:
                            if t[0] not in ("history", "earnings"):
                                t[3] = 0.0
                except Exception as exc:  # noqa: BLE001 - never let a request stop the loop
                    _log(f"reauth: ERROR - {exc}")
            for task in (backfill, report_refresh):
                if task is not None:
                    try:
                        task.process(_log)
                    except Exception as exc:  # noqa: BLE001
                        _log(f"{task.__name__}: ERROR - {exc}")

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
                    if label in ("history", "earnings") and outcome in ("error", "login_required"):
                        used = min(interval, SLOW_RETRY_SECONDS)  # don't wait a day to try again
                    elif label == "am_ladder" and isinstance(result, int) and result > 0:
                        used = result
                    else:
                        used = interval
                    t[3] = time.time() + used
                    _write_refresh_status(label, interval, t[3], outcome, message)
                    if label == "app" and reauth is not None:
                        try:
                            reauth.note_result(outcome)
                        except Exception as exc:  # noqa: BLE001
                            _log(f"reauth: ERROR - {exc}")
            time.sleep(TICK_SECONDS)
    except KeyboardInterrupt:
        _log("Stopped.")


if __name__ == "__main__":
    main()

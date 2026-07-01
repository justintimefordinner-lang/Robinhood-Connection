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

    0 16 * * 1-5  cd /path/to/robinhood-bridge && ./.venv/bin/python sync_trade_history.py

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
from datetime import datetime

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


def _run(label: str, fn) -> tuple[float, object]:
    start = time.time()
    result = None
    try:
        result = fn()
        _log(f"{label}: ok ({time.time() - start:.1f}s)")
    except SystemExit as exc:
        _log(f"{label}: skipped - {exc}")
    except Exception as exc:  # e.g. session expired, needs re-login
        _log(f"{label}: ERROR - {exc}")
    return time.time() - start, result


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
            for t in targets:
                label, fn, interval, next_run = t
                if now >= next_run:
                    elapsed, result = _run(label, fn)
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
            time.sleep(TICK_SECONDS)
    except KeyboardInterrupt:
        _log("Stopped.")


if __name__ == "__main__":
    main()

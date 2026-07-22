"""
login_guard.py
================

Shared, cross-process backoff for Robinhood login attempts.

Why this exists: robinhood_client.get_client() used to cache the logged-in
session only in an in-memory module variable (_cached_rh). That's fine within
one process, but this app runs several *separate* pm2 processes that each
import robinhood_client independently (databridge, databridge-earnings,
databridge-history, MinuteTracker, plus any one-off scripts you run by hand
like reconnect_robinhood.py). Each of those has its own Python interpreter and
therefore its own _cached_rh — so when login started failing, every one of
those processes was independently retrying on its own schedule, multiplying
the total request rate against Robinhood's auth endpoint far beyond what any
single process's retry loop would produce. That's the most likely reason a
"missed one push notification" turned into an hours-long rate-limit block.

This module fixes that by tracking failures in a small JSON file on disk
(shared by every process, since they all run as the same OS user on the same
machine) instead of in memory. Before ANY process attempts a real login, it
checks this file first. If we're in a cooldown window, the attempt is refused
locally — no request to Robinhood happens at all — regardless of which
process or script asked.

Schedule is intentionally conservative and grows fast for the first few
failures (a single blip clears in a couple minutes), but after
MANUAL_REQUIRED_AFTER consecutive failures, automatic retries stop
entirely — no more time-based auto-expiry, no waiting it out. At that point
only an explicit manual reconnect (the Settings page's "Reconnect Robinhood"
button, which always bypasses this gate immediately) will attempt another
login. This is deliberate: past a handful of failures, an automatic process
retrying on a timer is more likely to be the thing repeating whatever caused
the failures in the first place, and a person deciding to retry right now is
a meaningfully different, lower-risk action than a script doing it alone in
the background for hours.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

STATE_PATH = os.path.expanduser("~/.tokens/robinhood_login_state.json")

# consecutive_failures -> cooldown duration (minutes) before an AUTOMATIC
# retry is allowed. Index 0 unused (0 failures = no cooldown). Once failures
# reaches MANUAL_REQUIRED_AFTER, automatic retries stop entirely regardless
# of elapsed time — see manual_required in the state file.
_COOLDOWN_MINUTES = [0, 2, 10, 30]
MANUAL_REQUIRED_AFTER = 4


def _cooldown_minutes_for(failures: int) -> int:
    idx = min(failures, len(_COOLDOWN_MINUTES) - 1)
    return _COOLDOWN_MINUTES[idx]


_DEFAULT_STATE = {
    "consecutive_failures": 0,
    "locked_until": None,
    "manual_required": False,
    "last_attempt_at": None,
}


def _read_state() -> dict:
    if not os.path.exists(STATE_PATH):
        return dict(_DEFAULT_STATE)
    try:
        with open(STATE_PATH, "r") as f:
            return {**_DEFAULT_STATE, **json.load(f)}
    except (json.JSONDecodeError, OSError):
        return dict(_DEFAULT_STATE)


def _write_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    # Write-then-rename so a reader never sees a half-written file, and use a
    # basic advisory lock on the real path to keep concurrent writers from
    # interleaving. Good enough for "a handful of local processes", not
    # trying to be a distributed-systems-grade lock.
    tmp_path = STATE_PATH + f".tmp.{os.getpid()}"
    with open(tmp_path, "w") as f:
        json.dump(state, f)
    try:
        lock_path = STATE_PATH + ".lock"
        with open(lock_path, "w") as lockf:
            try:
                import fcntl

                fcntl.flock(lockf, fcntl.LOCK_EX)
            except ImportError:
                pass  # non-POSIX platform; proceed without the lock
            os.replace(tmp_path, STATE_PATH)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


class LoginLocked(RuntimeError):
    """Raised instead of attempting rh.login() at all when an AUTOMATIC
    caller hits either the short cooldown window or the manual-required
    gate. Never raised for manual=True callers."""


def check_not_locked(manual: bool = False) -> None:
    """Raise LoginLocked if an automatic attempt should be refused right now.

    Call this BEFORE attempting a real login — the whole point is to never
    even talk to Robinhood while gated.

    manual=True (the Settings page's Reconnect button, or any script the
    person explicitly ran themselves) always passes through immediately,
    regardless of any cooldown or manual_required state. That's intentional:
    once a person has decided to retry right now, there's no reason to make
    them wait — waiting is the automatic scheduler's problem to avoid, not
    theirs."""
    if manual:
        return

    state = _read_state()

    if state.get("manual_required"):
        raise LoginLocked(
            f"Automatic login retries are paused after {state.get('consecutive_failures', '?')} "
            f"consecutive failures. This won't retry on its own anymore — use the "
            f"'Reconnect Robinhood' button in Settings whenever you're ready to try again."
        )

    locked_until = state.get("locked_until")
    if not locked_until:
        return
    until_dt = datetime.fromisoformat(locked_until)
    now = datetime.now(timezone.utc)
    if now < until_dt:
        remaining = until_dt - now
        mins = max(1, int(remaining.total_seconds() // 60))
        raise LoginLocked(
            f"Robinhood login is paused after {state.get('consecutive_failures', '?')} "
            f"consecutive failures. Refusing to auto-retry for ~{mins} more minute(s) "
            f"(until {until_dt.strftime('%H:%M UTC')}) — or use 'Reconnect Robinhood' in "
            f"Settings to try again right now."
        )


def record_failure() -> None:
    """Call after a real login attempt fails (automatic OR manual — a manual
    attempt that fails still counts toward the threshold, since a person
    retrying manually right after a failure is the case MANUAL_REQUIRED_AFTER
    exists to eventually catch). Increments the failure count and either sets
    a short auto-retry cooldown (failures < MANUAL_REQUIRED_AFTER) or flips to
    manual_required with no auto-expiry (failures >= MANUAL_REQUIRED_AFTER)."""
    state = _read_state()
    failures = int(state.get("consecutive_failures", 0)) + 1
    now = datetime.now(timezone.utc)

    if failures >= MANUAL_REQUIRED_AFTER:
        _write_state(
            {
                "consecutive_failures": failures,
                "locked_until": None,
                "manual_required": True,
                "last_attempt_at": now.isoformat(),
            }
        )
        return

    cooldown_min = _cooldown_minutes_for(failures)
    locked_until = now + timedelta(minutes=cooldown_min)
    _write_state(
        {
            "consecutive_failures": failures,
            "locked_until": locked_until.isoformat(),
            "manual_required": False,
            "last_attempt_at": now.isoformat(),
        }
    )


def record_success() -> None:
    """Call after a real login attempt succeeds. Clears the failure count,
    any active cooldown, and the manual_required flag."""
    _write_state(
        {
            "consecutive_failures": 0,
            "locked_until": None,
            "manual_required": False,
            "last_attempt_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def status() -> dict:
    """Read-only snapshot for the Settings UI: are we locked, until when (if
    time-based), whether manual reconnect is required, how many consecutive
    failures. Never raises."""
    state = _read_state()
    manual_required = bool(state.get("manual_required"))
    locked_until = state.get("locked_until")
    locked = False
    if locked_until and not manual_required:
        try:
            locked = datetime.now(timezone.utc) < datetime.fromisoformat(locked_until)
        except ValueError:
            locked = False
    return {
        "locked": locked or manual_required,
        "manualRequired": manual_required,
        "locked_until": locked_until if locked else None,
        "consecutive_failures": int(state.get("consecutive_failures", 0)),
        "last_attempt_at": state.get("last_attempt_at"),
    }

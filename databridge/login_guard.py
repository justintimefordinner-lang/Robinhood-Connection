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

Schedule is intentionally conservative and grows fast: a single blip clears
in a couple minutes, but repeated failures push the wait out to hours, on
the theory that it's much cheaper to have you wait longer than to risk
another extended, account-wide rate-limit block.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone

STATE_PATH = os.path.expanduser("~/.tokens/robinhood_login_state.json")

# consecutive_failures -> cooldown duration before the next attempt is allowed.
# Index 0 is unused (0 failures = no cooldown); index goes up to the failure
# count, capping at the last entry for anything beyond it.
_COOLDOWN_MINUTES = [0, 2, 10, 30, 120, 360]  # last entry = 6h cap


def _cooldown_minutes_for(failures: int) -> int:
    idx = min(failures, len(_COOLDOWN_MINUTES) - 1)
    return _COOLDOWN_MINUTES[idx]


def _read_state() -> dict:
    if not os.path.exists(STATE_PATH):
        return {"consecutive_failures": 0, "locked_until": None, "last_attempt_at": None}
    try:
        with open(STATE_PATH, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"consecutive_failures": 0, "locked_until": None, "last_attempt_at": None}


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
    """Raised instead of attempting rh.login() at all when we're in a
    self-imposed cooldown from recent failures."""


def check_not_locked() -> None:
    """Raise LoginLocked if we're currently in a cooldown window. Call this
    BEFORE attempting a real login — the whole point is to never even talk
    to Robinhood while locked out."""
    state = _read_state()
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
            f"consecutive failures. Retrying too soon risks another rate-limit block, "
            f"so this is refusing to even attempt a login for ~{mins} more minute(s) "
            f"(until {until_dt.strftime('%H:%M UTC')})."
        )


def record_failure() -> None:
    """Call after a real login attempt fails. Increments the failure count
    and sets a new (longer) cooldown window."""
    state = _read_state()
    failures = int(state.get("consecutive_failures", 0)) + 1
    cooldown_min = _cooldown_minutes_for(failures)
    locked_until = datetime.now(timezone.utc) + timedelta(minutes=cooldown_min)
    _write_state(
        {
            "consecutive_failures": failures,
            "locked_until": locked_until.isoformat(),
            "last_attempt_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def record_success() -> None:
    """Call after a real login attempt succeeds. Clears the failure count
    and any active cooldown."""
    _write_state(
        {
            "consecutive_failures": 0,
            "locked_until": None,
            "last_attempt_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def status() -> dict:
    """Read-only snapshot for the Settings UI: are we locked, until when,
    how many consecutive failures. Never raises."""
    state = _read_state()
    locked_until = state.get("locked_until")
    locked = False
    if locked_until:
        try:
            locked = datetime.now(timezone.utc) < datetime.fromisoformat(locked_until)
        except ValueError:
            locked = False
    return {
        "locked": locked,
        "locked_until": locked_until if locked else None,
        "consecutive_failures": int(state.get("consecutive_failures", 0)),
        "last_attempt_at": state.get("last_attempt_at"),
    }

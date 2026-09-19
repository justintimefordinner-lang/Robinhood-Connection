"""
reauth.py
=========

Lets the dashboard ask for a Robinhood reconnect, and see the login state,
without ever running anything in this folder or reading anything out of it.

The dashboard used to spawn reconnect_robinhood.py directly and read
~/.tokens/robinhood_login_state.json off the disk. Inside containers it can do
neither: there is no Python next to it and no shared home folder. So the
request travels as a marker file and the answer travels as a status file:

    reauth_inbox/reconnect       the dashboard drops this (empty) when someone
                                 presses Reconnect Robinhood
    <APP_DATA_DIR>/robinhood-auth.json
                                 this module publishes the sanitized state

Nothing about HOW the login happens changes. A reconnect is still exactly one
robinhood_client.get_client(force=True, manual=True) call, the same single call
reconnect_robinhood.py makes, with the same login_guard bookkeeping around it.
The session pickle and the guard's state file stay where robin_stocks and
login_guard have always kept them (~/.tokens).

The status file carries no secrets: whether a sign-in is on file, a masked
username, whether a saved session exists, and login_guard's own state.

Called from auto_push's tick:
    reauth.init_status()      once at startup
    reauth.process_inbox()    every tick (cheap: one os.path.exists)
    reauth.note_result(...)   after the snapshot target runs, so "connected"
                              follows what the data feed actually experienced
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

INBOX_DIR = "reauth_inbox"
RECONNECT_MARKER = os.path.join(INBOX_DIR, "reconnect")
STATUS_NAME = "robinhood-auth.json"
TOKEN_PATH = os.path.expanduser("~/.tokens/robinhood.pickle")

# What the snapshot feed last experienced: None until it has run once.
_feed_ok: bool | None = None


def _log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] reauth: {msg}", flush=True)


def _data_dir() -> str | None:
    d = os.environ.get("APP_DATA_DIR")
    return d if d and os.path.isdir(d) else None


def _mask(username: str | None) -> str | None:
    """"justin@example.com" -> "ju•••@example.com". Enough to recognise the
    account, not enough to be worth reading out of a data folder."""
    if not username:
        return None
    name, sep, domain = username.partition("@")
    shown = name[:2] if len(name) > 2 else name[:1]
    return f"{shown}•••{sep}{domain}" if sep else f"{shown}•••"


def build_status(connecting: bool = False) -> dict:
    """The sanitized state, assembled from things this process can already see."""
    import login_guard
    import robinhood_client

    username, password, totp = robinhood_client.load_credentials()
    configured = bool(username and password)
    has_session = os.path.exists(TOKEN_PATH)
    guard = login_guard.status()
    state = login_guard._read_state()  # noqa: SLF001 - same package, read-only

    manual_required = bool(state.get("manual_required"))
    last_error_type = state.get("last_error_type")
    time_locked = bool(guard.get("locked")) and not manual_required

    if not configured:
        auth_status = "needs_setup"
    elif connecting:
        auth_status = "connecting"
    elif manual_required or time_locked or last_error_type:
        auth_status = "error"
    elif _feed_ok is False:
        auth_status = "needs_login"
    elif has_session or _feed_ok:
        auth_status = "connected"
    else:
        auth_status = "needs_login"

    return {
        "configured": configured,
        "username": _mask(username),
        "hasTotp": bool(totp),
        "hasSession": has_session,
        "authStatus": auth_status,
        "manualRequired": manual_required,
        "lockedUntil": state.get("locked_until") if time_locked else None,
        "consecutiveFailures": int(state.get("consecutive_failures") or 0),
        "lastAttemptAt": state.get("last_attempt_at"),
        "lastErrorType": last_error_type,
        "error": state.get("last_error_message"),
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def publish_status(connecting: bool = False) -> None:
    """Write robinhood-auth.json into the app's data folder. Best effort: a
    status display must never take the scheduler down."""
    data_dir = _data_dir()
    if not data_dir:
        return
    path = os.path.join(data_dir, STATUS_NAME)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(build_status(connecting=connecting), f)
        os.replace(tmp, path)
    except Exception as exc:  # noqa: BLE001
        _log(f"couldn't publish status: {exc}")


def init_status() -> None:
    try:
        os.makedirs(INBOX_DIR, exist_ok=True)
    except OSError:
        pass
    publish_status()


def note_result(outcome: str) -> None:
    """Fold the snapshot target's outcome into the published state, so the
    Settings card reads "connected" because data is actually flowing. Only a
    login lock counts against the connection: an ordinary error (a network
    blip, Robinhood having a moment) says nothing about the sign-in."""
    global _feed_ok
    if outcome == "ok":
        _feed_ok = True
    elif outcome == "login_required":
        _feed_ok = False
    # Republish every time: login_guard's state can change underneath us (a
    # forced re-login that failed), and this is one small file a minute.
    publish_status()


def process_inbox() -> bool:
    """If the dashboard asked for a reconnect, make the one attempt. Returns
    True when an attempt was made (the caller then runs its targets right away
    instead of waiting out their timers)."""
    global _feed_ok
    if not os.path.exists(RECONNECT_MARKER):
        return False
    # Take the marker first: a crash mid-login must not turn one button press
    # into a login attempt on every tick.
    try:
        os.remove(RECONNECT_MARKER)
    except OSError as exc:
        _log(f"couldn't clear the reconnect marker ({exc}); skipping this request")
        return False

    import robinhood_client

    _log("reconnect requested from the dashboard - making one login attempt")
    publish_status(connecting=True)
    try:
        robinhood_client.get_client(force=True, manual=True)
    except Exception as exc:  # noqa: BLE001 - recorded by login_guard inside get_client
        _log(f"RECONNECT_FAILED: {exc}")
        _feed_ok = False
        publish_status()
        return False
    _log("RECONNECT_OK")
    _feed_ok = True
    publish_status()
    return True

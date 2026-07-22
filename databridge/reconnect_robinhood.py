"""
reconnect_robinhood.py
=======================

One-off script that forces a brand-new Robinhood login, bypassing both the
in-process cache in robinhood_client.py AND the on-disk session cache that
`store_session=True` writes to `~/.tokens/robinhood.pickle`.

Why this is needed: a normal `get_client(force=True)` call only bypasses the
module-level cache. `rh.login()` itself still tries to reuse whatever's in
~/.tokens/robinhood.pickle first. If a previous login got as far as issuing
a device-approval push notification but was never approved (missed it,
closed the app, whatever), that half-finished session can sit there and get
silently retried instead of triggering a genuinely new device challenge.
Deleting the pickle file first guarantees `rh.login()` has nothing to reuse
and must talk to Robinhood fresh — which is what actually re-sends the
push notification to your phone.

Run directly:
    python reconnect_robinhood.py

Exit code 0 + "RECONNECT_OK" on success, non-zero + "RECONNECT_FAILED: ..."
on failure (printed to stdout either way so the calling process, e.g. the
Settings page's API route, can log the outcome).
"""

from __future__ import annotations

import os
import sys

TOKEN_PATH = os.path.expanduser("~/.tokens/robinhood.pickle")


def main() -> int:
    removed = False
    if os.path.exists(TOKEN_PATH):
        try:
            os.remove(TOKEN_PATH)
            removed = True
        except OSError as exc:
            print(f"RECONNECT_FAILED: could not remove {TOKEN_PATH}: {exc}")
            return 1

    # Import after the removal above so nothing has a chance to touch/reload
    # the old pickle first.
    import robinhood_client

    try:
        robinhood_client.get_client(force=True, manual=True)
    except Exception as exc:  # noqa: BLE001 - surface any auth error verbatim
        # manual=True means this call always bypassed login_guard's gate — so
        # a failure here is a REAL failure (bad credentials, Robinhood itself
        # rejecting the login, etc.), not a "you have to wait" message. It
        # still gets recorded via login_guard.record_failure() inside
        # get_client(), which is what escalates toward manual-required after
        # enough consecutive failures — this button just isn't blocked BY
        # that state itself.
        print(f"RECONNECT_FAILED: {exc}")
        return 1

    print(
        "RECONNECT_OK"
        + (f" (cleared stale session at {TOKEN_PATH})" if removed else " (no stale session file was present)")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

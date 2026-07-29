"""
reconnect_robinhood.py
=======================

One-off script that reconnects to Robinhood, used by the Settings page's
"Reconnect Robinhood" button.

EXACTLY ONE LOGIN ATTEMPT PER RUN - no loop, no internal retry.

We used to unconditionally delete ~/.tokens/robinhood.pickle before every
attempt, to guarantee a genuinely fresh login. That turned out to be both
unnecessary and counterproductive: robin_stocks' own login() already tries
the cached pickle session first and, only if that's stale, falls back to a
fresh username/password login (triggering a new device-approval challenge
if Robinhood requires one) - all within that single call. So we now just
make that one call and let it decide for itself whether a challenge is
needed:
  - If the existing session is still valid: succeeds immediately, no
    challenge, no push notification.
  - If it's stale: robin_stocks handles the fresh login + challenge itself,
    in this same call, and a device-approval push goes to your phone.

Either way, this script makes that call exactly once and stops - it does
not retry on failure. That matters because Robinhood's device-approval
challenge endpoint is what was getting hit repeatedly (and 429'd) every
time this script used to force a fresh session on every single press;
one attempt per press, with no pre-emptive wipe, means pressing the button
"just to check" no longer looks like a brand-new device unless it actually
is one - and a failure here means try again later, not immediately again.

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
    import robinhood_client

    had_existing_session = os.path.exists(TOKEN_PATH)
    print(
        "Reconnecting now. If the existing session has expired, Robinhood "
        "may send a device-approval prompt to your phone as part of this "
        "one attempt - check the Robinhood app now, just in case."
    )

    # Exactly ONE call, no pre-emptive pickle deletion, no internal retry
    # loop. robin_stocks' own login() already (a) tries the cached
    # ~/.tokens/robinhood.pickle session first, and (b) falls back to a
    # fresh username/password login - triggering a new device-approval
    # challenge if Robinhood requires one - within that SAME call if the
    # cached session turns out to be stale. So this single call already
    # covers both "still logged in, nothing to do" and "needs a fresh
    # challenge" - deleting the pickle ourselves first, or retrying again
    # after a failure, would only risk firing a second challenge attempt
    # (and a second chance at a 429) from one button press, which is the
    # opposite of what we want.
    try:
        robinhood_client.get_client(force=True, manual=True)
    except Exception as exc:  # noqa: BLE001 - surface any auth error verbatim
        # manual=True means this call always bypassed login_guard's gate — so
        # a failure here is a REAL failure (bad credentials, Robinhood itself
        # rejecting the login, a 429 on the challenge endpoint, etc.), not a
        # "you have to wait" message. It still gets recorded via
        # login_guard.record_failure() inside get_client(), which immediately
        # sets manual_required (MANUAL_REQUIRED_AFTER=1) so auto_push.py
        # stops trying on its own until you press this button again. We do
        # NOT retry again here - if this one attempt didn't work, the fix is
        # to try again later (network switch, waiting out a 429, etc.), not
        # to hammer it again right now.
        print(f"RECONNECT_FAILED: {exc}")
        return 1

    print(
        "RECONNECT_OK"
        + (" (fresh login/verification completed)" if not had_existing_session else " (session reused or refreshed)")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

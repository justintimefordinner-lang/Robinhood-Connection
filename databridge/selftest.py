"""
selftest.py — offline checks for the parts of the bridge the dashboard leans on.

Runs inside the built image (CI does `python /opt/bridge/selftest.py` with an
empty folder mounted at /state) or from a checkout. Never logs in and never
talks to Robinhood: the login call and the market-data calls are replaced with
fakes. What it proves is the plumbing around them — where credentials are read
from, what the published login status says, that one Reconnect press makes
exactly one manual login attempt, that once-a-day jobs resume on schedule, and
that a hand-entered account is valued by capital tied up.

Exit code 0 = all passed.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

FAILED: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("  ok    " if cond else "  FAIL  ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


def main() -> int:
    # A scratch working directory + home + data folder, unless the container
    # already provides them (cwd=/state, HOME=/state).
    if os.getcwd() != "/state":
        work = tempfile.mkdtemp(prefix="bridge-selftest-")
        os.chdir(work)
        os.environ["HOME"] = work
        os.environ["USERPROFILE"] = work
    for k in ("ROBINHOOD_USERNAME", "ROBINHOOD_PASSWORD", "ROBINHOOD_TOTP_SECRET"):
        os.environ.pop(k, None)
    data_dir = os.path.join(os.getcwd(), "selftest-data")
    os.makedirs(data_dir, exist_ok=True)
    os.environ["APP_DATA_DIR"] = data_dir
    in_image = os.path.islink("/opt/bridge/.env")

    print("imports")
    import auto_push
    for mod in ("reauth", "backfill", "report_refresh", "manual_positions"):
        check(f"auto_push loaded {mod}", getattr(auto_push, mod) is not None)

    import login_guard
    import manual_positions
    import reauth
    import robinhood_client as rc

    print("credentials")
    check("nothing on file -> no credentials", rc.load_credentials() == (None, None, None), str(rc.load_credentials()))
    if in_image:
        # .env is found NEXT TO THE CODE, through the /opt/bridge/.env -> /state/.env symlink.
        with open(".env", "w", encoding="utf-8") as f:
            f.write("ROBINHOOD_USERNAME=legacy@example.com\nROBINHOOD_PASSWORD=old\nROBINHOOD_TOTP_SECRET=JBSWY3DPEHPK3PXP\n")
        check(".env sign-in is honoured", rc.load_credentials() == ("legacy@example.com", "old", "JBSWY3DPEHPK3PXP"),
              str(rc.load_credentials()[0]))
    with open("credentials.env", "w", encoding="utf-8") as f:
        f.write("# written by the dashboard\nROBINHOOD_USERNAME=justin@example.com\nROBINHOOD_PASSWORD=pw with spaces=and#signs\n")
    u, p, t = rc.load_credentials()
    check("credentials.env wins, wholesale", (u, t) == ("justin@example.com", None), f"{u} {t}")
    check("password survives spaces and symbols", p == "pw with spaces=and#signs", repr(p))

    print("login status")
    st = reauth.build_status()
    check("configured", st["configured"] is True)
    check("username is masked", st["username"] == "ju•••@example.com", str(st["username"]))
    check("no session yet -> needs_login", st["authStatus"] == "needs_login", st["authStatus"])
    os.makedirs(os.path.dirname(reauth.TOKEN_PATH), exist_ok=True)
    open(reauth.TOKEN_PATH, "wb").close()
    check("session under HOME/.tokens", reauth.TOKEN_PATH.startswith(os.environ["HOME"]), reauth.TOKEN_PATH)
    check("saved session -> connected", reauth.build_status()["authStatus"] == "connected")
    login_guard.record_failure(error_message="429 Client Error: Too Many Requests for url get_prompts_status")
    st = reauth.build_status()
    check("failed login -> error + manual required", st["authStatus"] == "error" and st["manualRequired"] is True, json.dumps(st))
    check("failure classified as rate_limited", st["lastErrorType"] == "rate_limited", str(st["lastErrorType"]))
    reauth.publish_status()
    published = open(os.path.join(data_dir, reauth.STATUS_NAME), encoding="utf-8").read()
    check("published status holds no secret", "pw with" not in published and "justin@" not in published)

    print("reconnect")
    calls: list[tuple] = []
    real_get_client = rc.get_client

    def fake_get_client(force: bool = False, manual: bool = False):
        calls.append((force, manual))
        login_guard.record_success()
        return object()

    rc.get_client = fake_get_client
    check("no marker -> nothing happens", reauth.process_inbox() is False and not calls)
    os.makedirs(reauth.INBOX_DIR, exist_ok=True)
    open(reauth.RECONNECT_MARKER, "w").close()
    check("marker -> one attempt", reauth.process_inbox() is True and calls == [(True, True)], str(calls))
    check("marker consumed", not os.path.exists(reauth.RECONNECT_MARKER))
    check("second tick makes no second attempt", reauth.process_inbox() is False and len(calls) == 1)
    check("status back to connected", reauth.build_status()["authStatus"] == "connected")

    print("scheduler")
    now = datetime.now(timezone.utc)
    auto_push._REFRESH_STATUS.clear()
    check("never ran -> due now", auto_push._resume_at("history", 86400) == 0.0)
    auto_push._REFRESH_STATUS["history"] = {"lastAt": (now - timedelta(hours=1)).isoformat(timespec="seconds")}
    due = auto_push._resume_at("history", 86400)
    check("ran an hour ago -> due in ~23h", 22.9 * 3600 < due - time.time() < 23.1 * 3600, str(due - time.time()))
    auto_push._REFRESH_STATUS["history"] = {"lastAt": (now - timedelta(days=3)).isoformat(timespec="seconds")}
    check("missed while down -> catches up", auto_push._resume_at("history", 86400) < time.time())

    print("manual positions")

    class FakeOptions:
        lookups = 0
        quotes = 0

        def find_options_by_expiration_and_strike(self, symbol, exp, strike, optionType=None, info=None):
            FakeOptions.lookups += 1
            return [{"id": "11111111-2222-3333-4444-555555555555"}] if float(strike) == 16 else []

        def get_option_market_data_by_id(self, oid):
            FakeOptions.quotes += 1
            return [[{"mark_price": "0.50", "delta": "-0.21", "theta": "-0.02",
                      "implied_volatility": "0.61", "previous_close_price": "0.55"}]]

    class FakeRh:
        options = FakeOptions()

    rc.get_client = lambda force=False, manual=False: FakeRh()
    rc.get_stock_day = lambda rh, symbols: {s: {"price": 10.0, "change": 0.25} for s in symbols}
    manual_positions.QUOTE_THROTTLE_SEC = 0

    far = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
    with open(os.path.join(data_dir, "earnings.json"), "w", encoding="utf-8") as f:
        json.dump({"SOFI": "2099-01-01"}, f)  # nothing missing -> no network lookup
    with open(os.path.join(data_dir, manual_positions.MANUAL_FILE), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "accounts": [{"id": "manual-fidelity", "label": "Fidelity CSV", "cash": 1000, "positions": [
            {"id": "s1", "type": "stock", "symbol": "SOFI", "qty": 100, "avgCost": 9},
            {"id": "o1", "type": "option", "symbol": "SOFI", "optionType": "put", "side": "short", "qty": 1,
             "strike": 16, "expiration": far, "premium": 0.69, "openedAt": "2026-09-01"},
            {"id": "o2", "type": "option", "symbol": "SOFI", "optionType": "put", "side": "short", "qty": 1,
             "strike": 17.77, "expiration": far, "premium": 1.00},
        ]}]}, f)
    manual_positions.main()
    snap = json.load(open(os.path.join(data_dir, "manual", "snapshot.json"), encoding="utf-8"))
    acct = snap["data"]["manual-fidelity"]
    by_id = {o["id"]: o for o in acct["options"]}
    quoted, unquoted = by_id["manual-fidelity:o1"], by_id["manual-fidelity:o2"]
    check("short put is a CSP", quoted["kind"] == "csp", quoted["kind"])
    check("quoted from Robinhood", (quoted["mark"], quoted["delta"]) == (0.5, -0.21), f"{quoted['mark']} {quoted['delta']}")
    check("unknown contract valued at entry", unquoted["mark"] == 1.0, str(unquoted["mark"]))
    # cash 1000 + shares 100 x 10 + CSP (1600 + 19 P/L) + CSP at entry (1777 + 0)
    check("valued by collateral, never negative", acct["summary"]["totalValue"] == 5396.0, str(acct["summary"]["totalValue"]))
    check("account carries its label", snap["accounts"][0]["nickname"] == "Fidelity CSV")
    lookups = FakeOptions.lookups
    os.utime(os.path.join(data_dir, manual_positions.MANUAL_FILE), None)  # "edited": forces a reprice off-hours too
    manual_positions.main()
    check("instrument ids are looked up once", FakeOptions.lookups == lookups, f"{lookups} -> {FakeOptions.lookups}")

    rc.get_client = real_get_client
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + "; ".join(FAILED))
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

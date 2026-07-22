"""
robinhood_client.py
====================

Read-only data layer for Robinhood, mirroring the role schwab_client.py plays
for Schwab. Everything needed to build the app's snapshot lives here,
normalized into plain dicts/lists so export_to_app.py never touches the raw
robin_stocks payloads directly.

Deliberately contains NO order-placing or order-cancelling calls.

Uses the unofficial `robin_stocks` library (https://github.com/jmfernandes/robin_stocks).
Robinhood has no official public API for personal accounts, so this — like most
personal Robinhood tooling — logs in with your own credentials the same way the
mobile app does. Your credentials never leave this machine; only derived JSON
gets written to the app's data/ folder.

AUTH / MFA
----------
Robinhood requires a second factor on new-device logins. Two ways to handle it:

1. Interactive (simplest): leave ROBINHOOD_TOTP_SECRET unset. The first run
   will prompt in the terminal for the 6-digit code from your authenticator
   app or SMS. `store_session=True` caches the session afterward (in
   ~/.tokens/robinhood.pickle) so you won't be prompted every run — only when
   the session eventually expires.

2. Unattended (needed if this runs from systemd/cron with no terminal):
   set ROBINHOOD_TOTP_SECRET to the *secret key* Robinhood shows you when you
   set up an authenticator app (not the 6-digit code — the base32 seed behind
   it). This script then generates the current code itself via `pyotp`, so no
   human needs to be at a keyboard. Enable "Authenticator app" MFA in
   Robinhood's security settings to get this secret; you only see it once, so
   save it in your .env immediately.

NOTE ON FIELD NAMES: robin_stocks' returned dict keys have shifted slightly
across versions in the past. If something below throws a KeyError, run
`python -c "import robin_stocks.robinhood as rh; ..."` interactively, print
one raw record, and adjust the `.get(...)` calls to match — the rest of the
pipeline is defensive on purpose (missing fields become None/0 rather than
crashing the whole export).
"""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv

import login_guard

load_dotenv()

_USERNAME = os.environ.get("ROBINHOOD_USERNAME")
_PASSWORD = os.environ.get("ROBINHOOD_PASSWORD")
_TOTP_SECRET = os.environ.get("ROBINHOOD_TOTP_SECRET")  # optional, for unattended runs


class AuthError(RuntimeError):
    """Raised when login fails or credentials are missing."""


_cached_rh = None  # module-level so it's shared across every caller/import within one process


def get_client(force: bool = False, manual: bool = False):
    """Log in and return the robin_stocks module itself (it's function-based,
    not object-based, so there's no separate client object — this just
    centralizes the login call and env validation).

    Cached at module level after the first successful login. auto_push.py is
    a long-running process that calls this every cycle (every 60s for the
    app target alone, via export_to_app.main() -> get_client()) — without
    caching, that meant a brand-new rh.login() call, a fresh TOTP code, and a
    real request to Robinhood's auth endpoint every single cycle, all to get
    a session that was already valid. Now login only actually runs once per
    process; every other call just returns the same authenticated module.

    Pass force=True to bypass the in-process cache and force a fresh login —
    e.g. after a call elsewhere fails with an auth-looking error and you want
    to retry once with a new session rather than assuming the whole run is
    broken. force=True does NOT bypass login_guard's cooldown/manual-required
    gate below — an automatic retry is still an automatic retry.

    Pass manual=True ONLY when a person explicitly asked for this attempt
    right now (the Settings page's Reconnect button, reconnect_robinhood.py
    when run by hand). manual=True skips login_guard's gate entirely,
    regardless of any cooldown or manual-required state — see
    login_guard.check_not_locked() for why that's the intended behavior.
    Every other caller should leave this False.

    Before every real login attempt (cached or forced), this checks
    login_guard's cross-process cooldown state first (unless manual=True).
    If an automatic caller is gated (short cooldown, or manual-required after
    repeated failures), this raises immediately without making any request
    to Robinhood at all — that check happens regardless of which pm2 process
    or script called get_client(), since the state lives in a shared file,
    not in this process's memory."""
    global _cached_rh
    if _cached_rh is not None and not force:
        return _cached_rh

    login_guard.check_not_locked(manual=manual)

    if not _USERNAME or not _PASSWORD:
        raise AuthError(
            "Missing ROBINHOOD_USERNAME or ROBINHOOD_PASSWORD. "
            "Copy .env.example to .env and fill in your credentials."
        )

    import robin_stocks.robinhood as rh

    mfa_code = None
    if _TOTP_SECRET:
        import pyotp

        mfa_code = pyotp.TOTP(_TOTP_SECRET).now()

    # robin_stocks prints its own diagnostic messages during the login/
    # verification flow (e.g. "429 Client Error: Too Many Requests ...
    # get_prompts_status/") rather than including them in whatever it raises
    # or returns — our own AuthError below is just a generic fallback with
    # none of that detail. Tee-ing stdout here (not redirecting it) lets us
    # capture that detail for login_guard's classification WITHOUT hiding it
    # from wherever stdout already goes (pm2 logs, reconnect_robinhood.py's
    # log file) — those prints still show up live, exactly as before.
    import contextlib
    import io
    import sys

    class _Tee:
        def __init__(self, *streams):
            self._streams = streams

        def write(self, data):
            for s in self._streams:
                s.write(data)

        def flush(self):
            for s in self._streams:
                s.flush()

    captured = io.StringIO()
    tee = _Tee(sys.stdout, captured)
    try:
        with contextlib.redirect_stdout(tee):
            login_result = rh.login(
                username=_USERNAME,
                password=_PASSWORD,
                mfa_code=mfa_code,
                store_session=True,
            )
        if not login_result or not login_result.get("access_token"):
            raise AuthError("Robinhood login did not return an access token.")
    except Exception as exc:
        printed = captured.getvalue().strip()
        # Put whatever robin_stocks printed first — it's almost always the
        # more specific, useful detail (the actual HTTP error) — then our own
        # exception message as a fallback/supplement.
        detail = printed or str(exc)
        login_guard.record_failure(error_message=detail)
        raise

    login_guard.record_success()
    _cached_rh = rh
    return rh


def list_accounts(rh) -> list[dict[str, Any]]:
    """Return one dict per Robinhood account tied to this login: the main
    brokerage account plus any IRAs (Roth, Traditional) and similar —
    Robinhood personal logins are NOT 1:1 with a single account the way the
    original comment here assumed, and haven't been since Robinhood added
    retirement accounts. rh.profiles.load_account_profile() hits the exact
    same list-of-accounts endpoint this function needs, but its default
    dataType="indexzero" throws away every account except the first
    (data['results'][0]) — silently hiding every IRA. Overriding
    dataType="results" gets the full list this endpoint actually returns
    instead."""
    try:
        profiles = rh.profiles.load_account_profile(dataType="results") or []
    except Exception:
        profiles = []
    if isinstance(profiles, dict):
        profiles = [profiles]  # defensive: fall back gracefully if this ever comes back as a single dict
    out = []
    for profile in profiles:
        acct_num = profile.get("account_number") or "0000"
        raw_type = (profile.get("type") or profile.get("brokerage_account_type") or "").strip()
        out.append({
            "hash": f"rh-{acct_num}",     # opaque, unique, app key (mirrors Schwab's acct hash)
            "number": acct_num,
            "account_type": "margin" if (profile.get("margin_balances") or {}).get("margin_limit") else "cash",
            # Robinhood's own account-kind field (e.g. "individual",
            # "traditional_ira", "roth_ira"), normalized to spaced-out
            # words — export_to_app.py uses this for brokerageType instead
            # of hardcoding "individual" for every account.
            "robinhoodType": raw_type.replace("_", " ") or None,
        })
    return out


def get_account_snapshot(rh, account_hash: str) -> dict[str, Any]:
    """Pull cash/buying-power + all equity and option positions for ONE
    specific Robinhood account (brokerage or IRA) tied to this login.
    Robinhood personal logins can have several accounts (a brokerage
    account plus a Roth IRA, Traditional IRA, etc.), each with its own
    account_number and its own positions — every call below needs that
    account_number explicitly, or it silently only sees the default
    account. `account_hash` is this bridge's own "rh-<account_number>" id
    (see list_accounts); the real robin_stocks account_number is recovered
    by stripping the "rh-" prefix."""
    account_number = account_hash[3:] if account_hash.startswith("rh-") else account_hash
    profile = rh.profiles.load_account_profile(account_number=account_number) or {}
    portfolio = rh.profiles.load_portfolio_profile(account_number=account_number) or {}

    cash = float(profile.get("cash") or 0.0)
    buying_power = float(profile.get("buying_power") or profile.get("crypto_buying_power") or 0.0)
    liquidation_value = float(portfolio.get("equity") or 0.0)

    # margin_balances mirrors exactly what Robinhood's own "Buying power" detail
    # screen shows (Cash / Margin total / Options collateral / Total):
    #   - margin_limit: total margin this account is approved for (the ceiling,
    #     not what's currently borrowed)
    #   - unallocated_margin_cash: the UNUSED portion of that limit — this is
    #     literally the "$X,XXX available to invest" figure Robinhood's own UI
    #     shows, so margin actually drawn = margin_limit - unallocated_margin_cash
    #   - cash_held_for_options_collateral: cash currently tied up backing
    #     short options (cash-secured puts, etc.)
    margin_balances = profile.get("margin_balances") or {}
    margin_limit = float(margin_balances.get("margin_limit") or 0.0)
    unallocated_margin_cash = float(margin_balances.get("unallocated_margin_cash") or 0.0)
    margin_used = max(0.0, margin_limit - unallocated_margin_cash)
    options_collateral = float(margin_balances.get("cash_held_for_options_collateral") or 0.0)

    positions: list[dict[str, Any]] = []
    positions.extend(_equity_positions(rh, account_number))
    positions.extend(_option_positions(rh, account_number))

    return {
        "cash": cash,
        "buying_power": buying_power,
        "options_bp": None,  # Robinhood doesn't expose a separate options-BP figure
        "liquidation_value": liquidation_value,
        "account_type": "margin" if margin_limit else "cash",
        "margin_limit": margin_limit,
        "margin_used": margin_used,
        "options_collateral": options_collateral,
        "positions": positions,
    }


def _equity_positions(rh, account_number: str | None = None) -> list[dict[str, Any]]:
    """Per-account equity holdings. build_holdings() (the old approach here)
    is a convenient all-in-one helper, but it doesn't accept account_number
    — it can only ever see the default brokerage account, silently missing
    any stock held in an IRA. This hand-rolls the equivalent from
    get_open_stock_positions(account_number=...) plus a live quote per
    symbol instead."""
    try:
        raw = rh.account.get_open_stock_positions(account_number=account_number) or []
    except Exception:
        return []
    out = []
    for p in raw:
        qty = float(p.get("quantity") or 0.0)
        if qty == 0:
            continue
        try:
            symbol = rh.stocks.get_symbol_by_url(p.get("instrument"))
        except Exception:
            symbol = None
        if not symbol:
            continue
        avg_price = float(p.get("average_buy_price") or 0.0)
        last_price = avg_price
        try:
            quote = rh.stocks.get_latest_price(symbol)
            if quote and quote[0] is not None:
                last_price = float(quote[0])
        except Exception:
            pass
        out.append({
            "asset_type": "EQUITY",
            "ticker": symbol,
            "quantity": qty,
            "avg_price": avg_price,
            "underlying_price": last_price,
            "market_value": round(qty * last_price, 2),
        })
    return out


def _option_positions(rh, account_number: str | None = None) -> list[dict[str, Any]]:
    open_positions = rh.options.get_open_option_positions(account_number=account_number) or []
    out = []
    for p in open_positions:
        qty = float(p.get("quantity") or 0.0)
        if qty == 0:
            continue
        option_id = p.get("option_id") or _id_from_url(p.get("option"))
        instrument = rh.options.get_option_instrument_data_by_id(option_id) or {} if option_id else {}
        market = {}
        if option_id:
            md = rh.options.get_option_market_data_by_id(option_id)
            if md:
                # robin_stocks sometimes wraps this in a list-of-lists
                market = md[0] if isinstance(md, list) and md else (md or {})

        # 'type' on the position tells us long vs short in most robin_stocks
        # versions; fall back to treating everything as long if absent.
        is_short = (p.get("type") or "").lower() == "short"
        signed_qty = -qty if is_short else qty

        out.append({
            "asset_type": "OPTION",
            "symbol": option_id or p.get("option") or "",
            "ticker": p.get("chain_symbol", ""),
            "quantity": signed_qty,
            "avg_price": float(p.get("average_price") or 0.0) / 100.0,  # RH quotes total premium; normalize to per-share
            "put_call": (instrument.get("type") or "").upper(),  # "CALL" / "PUT"
            "strike": float(instrument.get("strike_price") or 0.0),
            "expiration": instrument.get("expiration_date"),
            "market_value": abs(float(p.get("average_price") or 0.0)) * qty,  # placeholder; refined via market data below
            "underlying_price": None,  # filled in by export_to_app via a quote lookup
            "delta": _to_float(market.get("delta")),
            "theta": _to_float(market.get("theta")),
            "iv": _to_float(market.get("implied_volatility")),
            "mark": _to_float(market.get("mark_price") or market.get("adjusted_mark_price")),
            # Robinhood's own timestamp for this position record. Best-effort
            # "opened" date: for a straightforward single trade it's exactly
            # right, but if the position was later adjusted (e.g. partially
            # closed/rolled) this reflects that record's created_at rather
            # than necessarily the very first fill — good enough here since
            # true original-open tracking would require full order history
            # (sync_trade_history.py), which this real-time bridge
            # deliberately doesn't pull every cycle.
            "created_at": p.get("created_at"),
        })
    return out


def get_crypto_holdings(rh) -> list[dict[str, Any]]:
    """Optional: Robinhood *does* expose crypto positions (unlike Schwab)."""
    try:
        positions = rh.crypto.get_crypto_positions() or []
    except Exception:
        return []
    out = []
    for p in positions:
        qty = float(p.get("quantity") or 0.0)
        if qty == 0:
            continue
        currency = (p.get("currency") or {})
        code = currency.get("code", "")
        try:
            price = float(rh.crypto.get_crypto_quote(code).get("mark_price") or 0.0)
        except Exception:
            price = 0.0
        out.append({
            "symbol": code,
            "name": currency.get("name", code),
            "qty": qty,
            "price": price,
        })
    return out


def get_quotes(rh, symbols: list[str]) -> dict[str, float | None]:
    """Latest price for a list of equity/index tickers. Robinhood has no VIX
    quote, so this is used for underlying prices, not vol indices."""
    if not symbols:
        return {}
    try:
        prices = rh.stocks.get_latest_price(symbols) or []
    except Exception:
        return {sym: None for sym in symbols}
    return {sym: _to_float(px) for sym, px in zip(symbols, prices)}


def _id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    return url.rstrip("/").rsplit("/", 1)[-1]


def _to_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Price history (research_sync.py / am_report.py)
# ---------------------------------------------------------------------------
def get_price_history(rh, symbol: str, days: int = 400) -> list[dict[str, Any]]:
    """Daily OHLCV candles for the last ~`days` calendar days, oldest first —
    same {open,high,low,close,volume,datetime} shape schwab_client.get_price_history
    returns, so indicators.py/research_sync.py/am_report.py don't need to care
    which broker it came from. `datetime` is epoch milliseconds (UTC midnight
    of the session date), matching Schwab's convention.

    Robinhood's historicals endpoint caps how far back a single call goes by
    `span`; we pick the smallest span that comfortably covers `days`.
    """
    import time as _time
    from datetime import datetime as _dt

    # Robinhood's daily-interval historicals only accept span="year" or
    # span="5year" — no "3month"/"3year" option exists for daily bars (those
    # are only valid with shorter intervals like "hour"). Passing anything
    # else makes robin_stocks raise "Span must be ..." instead of the data
    # we asked for.
    span = "5year" if days > 300 else "year"
    try:
        candles = rh.stocks.get_stock_historicals(
            symbol, interval="day", span=span, bounds="regular"
        ) or []
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for c in candles:
        try:
            ts = c.get("begins_at")  # ISO 8601, e.g. "2026-06-15T00:00:00Z"
            epoch_ms = int(_dt.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            epoch_ms = int(_time.time() * 1000)
        out.append({
            "datetime": epoch_ms,
            "open": _to_float(c.get("open_price")),
            "high": _to_float(c.get("high_price")),
            "low": _to_float(c.get("low_price")),
            "close": _to_float(c.get("close_price")),
            "volume": _to_float(c.get("volume")) or 0,
        })
    cutoff_days = days
    return out[-min(len(out), max(cutoff_days, 40)):]


# ---------------------------------------------------------------------------
# Option chain (am_report.py) — mirrors schwab_client.get_option_chain's shape:
# {"putExpDateMap": {"YYYY-MM-DD:DTE": {strike: [{...}]}}, "callExpDateMap": {...},
#  "underlyingPrice": float}
#
# PERFORMANCE / RATE-LIMIT NOTE: Schwab serves an entire multi-expiration chain
# in ONE HTTP call. Robinhood's retail API has no batch equivalent — each
# strike's greeks/OI needs its own call. To keep this from turning a ~56-name
# board into thousands of requests, this version fetches only ONE expiration
# (the nearest to the ~30-DTE target, same one put_ladder() actually uses),
# and for puts, only strikes inside a %-OTM band aimed at the -0.15..-0.30
# delta zone the CSP screen/gate actually use (`put_pct_band`) — rather than
# the `strike_count` strikes nearest the money, most of which land outside
# that band and get fetched for nothing. Calls (gamma-wall side) still use a
# modest spot-centered spread. That means am_report's gamma-wall math runs on
# a narrower strike set than the Schwab version did — still directionally
# useful, just less exhaustive. If you widen `strike_count`/`put_pct_band` or
# fetch multiple expirations, watch for HTTP 429s; robin_stocks talks to an
# unofficial, undocumented API and Robinhood can and does throttle/block
# unusual call volume.
# ---------------------------------------------------------------------------
def get_option_chain(
    rh, symbol: str, days: int = 45, strike_count: int = 8, puts_only: bool = False,
    throttle_sec: float = 0.2, put_pct_band: tuple[float, float] = (3.0, 25.0),
) -> dict[str, Any] | None:
    """`put_pct_band` pre-filters PUT strikes to a %-below-spot price window before
    spending any per-strike API calls, instead of just grabbing the `strike_count`
    strikes nearest the money. Delta isn't known until after a strike's quote comes
    back, so this is a price-based proxy for it — the default (3%-25% OTM) is wide
    enough to bracket the -0.15..-0.30 delta zone that both the CSP screen's gate
    (_put_at_delta, target 0.30) and the display ladder (put_ladder, centered on
    20-delta) actually use, across most IV regimes, while skipping the near-ATM/ITM
    and deep-OTM strikes that were previously fetched and then thrown away. Calls
    (only pulled when puts_only=False, for the gamma-wall profile) still use a
    plain spot-centered spread since that needs the full range either side of spot.
    strike_count now also caps how many strikes are actually pulled per side."""
    import time as _time
    from datetime import date as _date

    try:
        quote = rh.stocks.get_latest_price([symbol])
        spot = _to_float(quote[0]) if quote else None
    except Exception:
        spot = None

    try:
        chains = rh.options.get_chains(symbol)
    except Exception:
        return None
    exp_dates = (chains or {}).get("expiration_dates") or []
    if not exp_dates:
        return None

    target_lo, target_hi = 25, 45  # DTE window, mirrors am_report's CONFIG default
    best_exp, best_dte = None, None
    for exp in exp_dates:
        try:
            dte = (_date.fromisoformat(exp) - _date.today()).days
        except ValueError:
            continue
        if dte < 0:
            continue
        if best_dte is None or abs(dte - 30) < abs(best_dte - 30):
            if target_lo - 10 <= dte <= target_hi + 10 or best_exp is None:
                best_exp, best_dte = exp, dte
    if not best_exp:
        return None

    try:
        puts = rh.options.find_options_by_expiration(symbol, expirationDate=best_exp, optionType="put") or []
        all_strikes = sorted({_to_float(p.get("strike_price")) for p in puts if p.get("strike_price")})
    except Exception:
        all_strikes = []
    if not all_strikes:
        return None

    if spot is not None:
        lo_pct, hi_pct = put_pct_band
        band_lo, band_hi = spot * (1 - hi_pct / 100), spot * (1 - lo_pct / 100)
        put_strikes = sorted(k for k in all_strikes if band_lo <= k <= band_hi)
        if not put_strikes:
            # Strike spacing on this name is wider than the band (e.g. a $10-wide
            # chain) — fall back to the strikes nearest a ~10%-OTM anchor so the
            # ladder isn't empty.
            anchor = spot * 0.90
            put_strikes = sorted(all_strikes, key=lambda k: abs(k - anchor))[:strike_count]
        elif len(put_strikes) > strike_count:
            # Spread evenly across the whole band (near-money -> far-OTM)
            # instead of taking the strikes nearest spot, which would cluster
            # everything at the near end and miss the ~20-delta strikes that
            # sit further out on higher-beta/higher-IV names.
            n = len(put_strikes)
            idxs = sorted({round(i * (n - 1) / (strike_count - 1)) for i in range(strike_count)})
            put_strikes = [put_strikes[i] for i in idxs]
    else:
        put_strikes = all_strikes[:strike_count]

    if puts_only:
        strikes_by_side = {"put": put_strikes}
    else:
        if spot is not None:
            call_strikes = sorted(all_strikes, key=lambda k: abs(k - spot))[:strike_count]
        else:
            call_strikes = all_strikes[:strike_count]
        strikes_by_side = {"put": put_strikes, "call": call_strikes}

    put_map: dict[str, Any] = {}
    call_map: dict[str, Any] = {}
    for side, side_strikes in strikes_by_side.items():
        strike_book: dict[str, list[dict[str, Any]]] = {}
        for k in side_strikes:
            try:
                md = rh.options.get_option_market_data(symbol, best_exp, str(k), side)
            except Exception:
                md = None
            if throttle_sec:
                _time.sleep(throttle_sec)
            if not md:
                continue
            # robin_stocks' get_option_market_data returns a list of lists —
            # one inner list per symbol passed in, even for a single symbol —
            # so this can be nested more than one level deep depending on
            # version. Unwrap however many levels actually show up.
            row = md
            while isinstance(row, list):
                if not row:
                    row = None
                    break
                row = row[0]
            if not isinstance(row, dict):
                continue
            iv = _to_float(row.get("implied_volatility"))
            strike_book[str(k)] = [{
                "delta": _to_float(row.get("delta")),
                "gamma": _to_float(row.get("gamma")),
                "volatility": (iv * 100) if iv is not None else None,  # normalize to Schwab's percent convention
                "bid": _to_float(row.get("bid_price")),
                "ask": _to_float(row.get("ask_price")),
                "mark": _to_float(row.get("mark_price") or row.get("adjusted_mark_price")),
                "openInterest": _to_float(row.get("open_interest")) or 0,
            }]
        key = f"{best_exp}:{best_dte}"
        if side == "put":
            put_map[key] = strike_book
        else:
            call_map[key] = strike_book

    if not put_map and not call_map:
        return None
    return {"putExpDateMap": put_map, "callExpDateMap": call_map, "underlyingPrice": spot}


# ---------------------------------------------------------------------------
# VIX cash-allocation framework — pure, unchanged from schwab_client.py.
# ---------------------------------------------------------------------------
VIX_GUIDE = [
    {"low": 0.0, "high": 12.0, "regime": "Extreme Greed",
     "cash_low": 40, "cash_high": 50, "cash": "40-50%", "invested": "50-60%"},
    {"low": 12.0, "high": 15.0, "regime": "Greed",
     "cash_low": 30, "cash_high": 40, "cash": "30-40%", "invested": "60-70%"},
    {"low": 15.0, "high": 20.0, "regime": "Slight Fear",
     "cash_low": 20, "cash_high": 25, "cash": "20-25%", "invested": "75-80%"},
    {"low": 20.0, "high": 30.0, "regime": "Fear",
     "cash_low": 10, "cash_high": 15, "cash": "10-15%", "invested": "90-95%"},
    {"low": 30.0, "high": 1000.0, "regime": "Extreme Fear",
     "cash_low": 0, "cash_high": 5, "cash": "0-5%", "invested": "95-100%",
     "note": "Find $$$!"},
]


def vix_band(vix: float | None) -> dict | None:
    if vix is None:
        return None
    for band in VIX_GUIDE:
        if band["low"] <= vix < band["high"]:
            return band
    return None


def vix_regime(vix: float | None) -> str | None:
    band = vix_band(vix)
    return band["regime"] if band else None

"""
export_to_app.py  (Robinhood bridge)
=====================================

Maps robinhood_client's output into the exact `Snapshot` shape the Next.js
app reads from data/snapshot.json — same contract export_to_app.py (Schwab)
fills, so the two bridges are interchangeable/combinable as data sources.

Run with:
    python export_to_app.py

One-time setup: in .env, point APP_DATA_DIR at the app's data folder:
    APP_DATA_DIR=/home/pi/wheel-toolkit/appfiles/data

Read-only: this never places or cancels an order.

SCOPE: this script covers the core positions/summary feed (snapshot.json +
value-history.json). The Morning Brief / CSP screener / research signals /
closed-trade history are separate files built by am_report.py,
research_sync.py, and sync_trade_history.py respectively — run those too
(auto_push.py runs the first two on a schedule already; sync_trade_history.py
is meant for a daily cron job, see its own docstring).
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from typing import Any

SNAPSHOT_FILE = "snapshot.json"
HISTORY_FILE = "value-history.json"
VIX_FILE = "vix.json"
HISTORY_MAX = 365
SOURCE_LABEL = "databridge"


def _realized_vol_pct(closes: list[float], n: int = 20) -> float | None:
    """Annualized close-to-close realized vol over the last n sessions, as a
    PERCENT (e.g. 12.5 -> 12.5%). Same math as am_report.realized_vol, x100 so
    it's directly comparable to the VIX in points."""
    import math

    closes = [float(x) for x in closes if x is not None and float(x) > 0]
    if len(closes) < n + 1:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - n, len(closes))
            if closes[i - 1] > 0]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252) * 100.0


def _app_data_dir() -> str:
    d = os.environ.get("APP_DATA_DIR")
    if not d:
        raise SystemExit(
            "Set APP_DATA_DIR in your .env to the app's data folder, e.g.\n"
            "  APP_DATA_DIR=/home/pi/wheel-toolkit/appfiles/data"
        )
    if not os.path.isdir(d):
        raise SystemExit(
            f"APP_DATA_DIR '{d}' does not exist. Point it at the folder that "
            "contains the app's snapshot.json."
        )
    return d


def _round(v: float | None, n: int = 2) -> float | None:
    return round(v, n) if isinstance(v, (int, float)) else None


def _kind_for(p: dict[str, Any]) -> str:
    """Robinhood positions carry no wheel-strategy classifier the way the
    Schwab bridge's category field does, so this is a best-effort guess from
    shape alone: short puts -> csp, long calls -> leap-call (no DTE gate —
    see below), long puts far out -> hedge, everything else -> other. Good
    enough to populate the tabs; refine by hand if you run a mixed book.

    Long calls are classified as leap-call regardless of DTE. This used to
    require dte >= 270, but that meant a position tracked as a LEAP would
    silently fall out of the LEAPs page (reclassified to "other" and hidden
    from that tab) purely because time passed and it crossed the threshold
    — even though it's the same open position you originally entered as a
    LEAP. Every open long call belongs on the LEAPs page for the life of
    the trade; DTE is still shown as a column there so you can see it
    aging, it's just no longer a cutoff for visibility."""
    pc = (p.get("put_call") or "").upper()
    is_put = pc == "PUT"
    signed_qty = p.get("quantity") or 0
    is_short = signed_qty < 0
    dte = _dte(p.get("expiration"))

    if is_put and is_short:
        return "csp"
    if not is_put and is_short:
        return "covered-call"
    if not is_put and not is_short:
        return "leap-call"
    if is_put and not is_short and (dte is None or dte >= 270):
        return "leap-put-hedge"
    return "other"


def _dte(expiration: str | None) -> int | None:
    if not expiration:
        return None
    try:
        exp = date.fromisoformat(expiration)
    except ValueError:
        return None
    return (exp - date.today()).days


def map_equity(p: dict[str, Any], stock_day: dict | None = None) -> dict[str, Any]:
    ticker = p.get("ticker", "")
    sd = (stock_day or {}).get(ticker, {})
    return {
        "symbol": ticker,
        "name": ticker,
        "qty": p.get("quantity") or 0,
        "avgCost": _round(p.get("avg_price")),
        "price": _round(p.get("underlying_price")),
        "dayChange": _round(sd.get("change")),  # per-share $ move today (Top Movers)
    }


def map_option(p: dict[str, Any], underlying_price: float | None, stock_day: dict | None = None) -> dict[str, Any]:
    pc = (p.get("put_call") or "").upper()
    is_put = pc == "PUT"
    signed_qty = p.get("quantity") or 0
    qty = abs(signed_qty)
    side = "short" if signed_qty < 0 else "long"
    entry = abs(p.get("avg_price") or 0.0)
    strike = p.get("strike") or 0.0
    mark = p.get("mark")
    if mark is None:
        mv = abs(p.get("market_value") or 0.0)
        mark = mv / (100 * qty) if qty else 0.0
    delta = p.get("delta")
    theta = p.get("theta")
    iv = p.get("iv")
    breakeven = (strike + entry) if not is_put else (strike - entry)
    created_at = p.get("created_at")
    opened_at = created_at[:10] if isinstance(created_at, str) and len(created_at) >= 10 else None

    # Day's change in THIS leg's market value: the contract's per-share move since
    # its prior close, times 100 x contracts, signed by side — a long gains when the
    # option rises, a short gains when it falls. None when the feed omits either
    # price, so Top Movers simply skips the leg instead of showing a bogus number.
    sd = (stock_day or {}).get(p.get("ticker", ""), {})
    prev_close = p.get("prev_close")
    day_val = None
    if mark is not None and prev_close is not None and qty:
        side_sign = -1.0 if side == "short" else 1.0
        day_val = side_sign * (mark - prev_close) * 100 * qty

    opt: dict[str, Any] = {
        "id": p.get("symbol", ""),
        "kind": _kind_for(p),
        "symbol": p.get("ticker", ""),
        "optionType": "put" if is_put else "call",
        "side": side,
        "qty": qty,
        "strike": _round(strike),
        "expiration": p.get("expiration"),
        "entryPerShare": _round(entry),
        "mark": _round(mark),
        "delta": _round(delta) if delta is not None else 0.0,
        "theta": _round(theta) if theta is not None else 0.0,
        "iv": _round(iv, 4) if iv is not None else 0.0,
        "breakeven": _round(breakeven),
        "underlyingPrice": _round(underlying_price),
        "underlyingChange": _round(sd.get("change")),  # underlying per-share $ move today
        "dayValueChange": _round(day_val),  # this leg's signed $ value move today
    }
    if opened_at:
        opt["openedAt"] = opened_at
    if side == "short" and delta is not None:
        opt["chanceOfProfitShort"] = _round(max(0.0, min(1.0, 1 - abs(delta))), 3)
    return opt


COVERED_CALL_CACHE_FILE = "covered_calls.json"
CC_TTL_SEC = 300  # re-pull a ticker's ladder at most every ~5 minutes
CC_MIN_SHARES = 100  # one contract's worth — below this you can't write a call


def _cc_market_open() -> bool:
    """Rough US regular-session gate (weekday, 9:30–16:00 ET). Ladders only refresh
    while the market is open; off-hours we serve the last cached pull, since option
    quotes are stale anyway and every strike costs an API call."""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        return True  # no tz data — don't block refreshes
    if now.weekday() >= 5:
        return False
    mins = now.hour * 60 + now.minute
    return 570 <= mins < 960


def _enrich_covered_calls(rh, account_data: dict, cache: dict, now_ts: float, market_open: bool) -> None:
    """Attach the ~30-delta covered-call ladder to every holding of >=100 shares.

    Each ticker's ladder is cached with a short TTL; off-hours we reuse whatever was
    cached rather than spending calls on stale quotes. A failed pull keeps the
    previous ladder instead of blanking the row.
    """
    try:
        import robinhood_client as rc
    except Exception:
        return
    for e in account_data.get("equities", []):
        sym, spot = e.get("symbol"), e.get("price")
        if not sym or not spot or (e.get("qty") or 0) < CC_MIN_SHARES:
            continue
        ent = cache.get(sym) or {}
        fresh = ent.get("ts") is not None and (now_ts - ent["ts"]) < CC_TTL_SEC
        if fresh or (not market_open and ent.get("cc")):
            if ent.get("cc"):
                e["coveredCalls"] = ent["cc"]
            continue
        try:
            cc = rc.get_covered_calls(rh, sym, spot)
        except Exception:
            cc = None
        if cc:
            cache[sym] = {"ts": now_ts, "cc": cc}
            e["coveredCalls"] = cc
        elif ent.get("cc"):
            e["coveredCalls"] = ent["cc"]  # bad pull — keep the last good ladder


def _enrich_price_history(rh, account_data: dict, days: int = 7) -> None:
    """Attach the last ~`days` daily closes to each holding, for the mini chart in
    the Stocks page's expanded row. Best-effort per ticker: a symbol whose candles
    fail to load simply goes without a chart rather than failing the export."""
    try:
        import robinhood_client as rc
    except Exception:
        return
    for e in account_data.get("equities", []):
        sym = e.get("symbol")
        if not sym:
            continue
        try:
            candles = rc.get_price_history(rh, sym, days=max(days * 3, 40)) or []
        except Exception:
            continue
        closes = [c["close"] for c in candles if c.get("close") is not None]
        if len(closes) >= 2:
            e["priceHistory"] = [round(c, 2) for c in closes[-days:]]


def build_account_data(
    rh,
    snap: dict[str, Any],
    points: list[dict[str, Any]],
) -> dict[str, Any]:
    positions = snap.get("positions", [])
    eq_positions = [p for p in positions if (p.get("asset_type") or "").upper() == "EQUITY"]
    opt_positions = [p for p in positions if (p.get("asset_type") or "").upper() == "OPTION"]

    # Day price + point-change for every held stock AND every option underlying, so
    # the Top Movers tiles can aggregate the day's $ move per ticker.
    day_syms = sorted({p.get("ticker") for p in (eq_positions + opt_positions) if p.get("ticker")})
    try:
        import robinhood_client as rc
        stock_day = rc.get_stock_day(rh, day_syms) if day_syms else {}
    except Exception:
        stock_day = {}

    equities = [map_equity(p, stock_day) for p in eq_positions]

    underlyings = sorted({p.get("ticker") for p in opt_positions if p.get("ticker")})
    try:
        import robinhood_client as rc
        quotes = rc.get_quotes(rh, underlyings) if underlyings else {}
    except Exception:
        quotes = {}
    options = [map_option(p, quotes.get(p.get("ticker")), stock_day) for p in opt_positions]

    # Daily closes behind each holding's expanded-row mini chart.
    _enrich_price_history(rh, {"equities": equities})

    crypto_raw = []
    try:
        import robinhood_client as rc
        crypto_raw = rc.get_crypto_holdings(rh)
    except Exception:
        pass
    crypto = [
        {"symbol": c["symbol"], "name": c["name"], "qty": c["qty"], "price": _round(c["price"])}
        for c in crypto_raw
    ]
    crypto_value = sum((c["qty"] or 0) * (c["price"] or 0) for c in crypto)

    total = snap.get("liquidation_value") or 0.0
    cash = snap.get("cash") or 0.0
    equity_value = sum((e["qty"] or 0) * (e["price"] or 0) for e in equities)
    options_value = total - equity_value - cash - crypto_value

    return {
        "summary": {
            "totalValue": _round(total),
            "equityValue": _round(equity_value),
            "optionsValue": _round(options_value),
            "cryptoValue": _round(crypto_value),
            "cash": _round(cash),
            "buyingPower": _round(snap.get("buying_power") or 0.0),
            "marginLimit": _round(snap.get("margin_limit") or 0.0),
            "marginUsed": _round(snap.get("margin_used") or 0.0),
            "optionsCollateral": _round(snap.get("options_collateral") or 0.0),
        },
        "equities": equities,
        "options": options,
        "valueHistory": points,
        "crypto": crypto or None,
    }


def build_snapshot(
    app_accounts: list[dict[str, Any]],
    data_by_account: dict[str, dict[str, Any]],
    prices_as_of: str,
) -> dict[str, Any]:
    return {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "pricesAsOf": prices_as_of,
            "source": SOURCE_LABEL,
        },
        "accounts": app_accounts,
        "data": data_by_account,
    }


def load_history(data_dir: str) -> dict[str, list[dict[str, Any]]]:
    path = os.path.join(data_dir, HISTORY_FILE)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_history(data_dir: str, history: dict[str, list[dict[str, Any]]]) -> None:
    path = os.path.join(data_dir, HISTORY_FILE)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)


def update_history(
    history: dict[str, list[dict[str, Any]]],
    account_id: str,
    value: float | None,
    label: str,
) -> list[dict[str, Any]]:
    points = history.setdefault(account_id, [])
    rounded = _round(value)
    if points and points[-1].get("label") == label:
        points[-1]["value"] = rounded
    else:
        points.append({"label": label, "value": rounded})
    if len(points) > HISTORY_MAX:
        del points[: len(points) - HISTORY_MAX]
    history[account_id] = points
    return points


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    import robinhood_client as rc

    data_dir = _app_data_dir()
    rh = rc.get_client()
    accounts = rc.list_accounts(rh)
    if not accounts:
        # Empty result from a cached session most often means the session
        # went stale (e.g. the ~24h token expired) rather than the account
        # genuinely having zero accounts — force one fresh login and retry
        # before giving up, so a long-running auto_push.py process can
        # recover on its own instead of erroring every cycle until restarted.
        print("No accounts on cached session — forcing a fresh login and retrying once...")
        rh = rc.get_client(force=True)
        accounts = rc.list_accounts(rh)
    if not accounts:
        raise SystemExit("No Robinhood account found.")

    history = load_history(data_dir)
    today = date.today().isoformat()
    prices_as_of = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")

    app_accounts: list[dict[str, Any]] = []
    data_by_account: dict[str, dict[str, Any]] = {}

    # Covered-call ladders: short-TTL cache on disk, refreshed only in market hours.
    try:
        with open(os.path.join(data_dir, COVERED_CALL_CACHE_FILE), encoding="utf-8") as f:
            cc_cache = json.load(f)
    except Exception:
        cc_cache = {}
    cc_now = datetime.now().timestamp()
    cc_market_open = _cc_market_open()

    for i, acct in enumerate(accounts):
        acct_id = acct["hash"]
        last4 = (acct.get("number") or "")[-4:]
        print(f"Pulling Robinhood account ****{last4} ...")

        snap = rc.get_account_snapshot(rh, acct_id)
        points = update_history(history, acct_id, snap.get("liquidation_value"), today)

        app_accounts.append({
            "id": acct_id,
            "mask": f"\u2022\u2022\u2022\u2022{last4}",
            "type": (snap.get("account_type") or "margin").lower(),
            "brokerageType": acct.get("robinhoodType") or "individual",
            "isDefault": i == 0,
        })
        data_by_account[acct_id] = build_account_data(rh, snap, points)
        _enrich_covered_calls(rh, data_by_account[acct_id], cc_cache, cc_now, cc_market_open)

    snapshot = build_snapshot(app_accounts, data_by_account, prices_as_of)
    # Tell the app when the ladders next refresh (null off-hours, when they don't).
    snapshot["meta"]["coveredCallsNextAt"] = (
        datetime.fromtimestamp(cc_now + CC_TTL_SEC, timezone.utc).isoformat(timespec="seconds")
        if cc_market_open else None
    )

    out_path = os.path.join(data_dir, SNAPSHOT_FILE)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)
    save_history(data_dir, history)
    try:
        with open(os.path.join(data_dir, COVERED_CALL_CACHE_FILE), "w", encoding="utf-8") as f:
            json.dump(cc_cache, f)
    except OSError:
        pass  # cache is an optimization — never fail the export over it

    n_pos = sum(len(d["equities"]) + len(d["options"]) for d in data_by_account.values())
    print(f"Wrote {out_path}  ({len(app_accounts)} account(s), {n_pos} positions).")

    # VIX tab. Robinhood has no index quotes at all, so this is entirely
    # market_data.py (Yahoo) — same rationale as am_report.py's regime block.
    try:
        import market_data as md

        fam = md.get_vix_family()
        vix_level = fam.get("vix")
        if vix_level is not None:
            spy_closes = md.get_daily_closes("SPY", days=60)
            rv20 = _realized_vol_pct(spy_closes, 20) if spy_closes else None
            vix_payload = {
                "asof": prices_as_of,
                "source": SOURCE_LABEL,
                "inputs": {
                    "vix": vix_level,
                    "vix9d": fam.get("vix9d"), "vix3m": fam.get("vix3m"),
                    "vvix": fam.get("vvix"), "skew": fam.get("skew"),
                    "realizedVol20": rv20, "realizedVol30": None,
                },
            }
            with open(os.path.join(data_dir, VIX_FILE), "w", encoding="utf-8") as f:
                json.dump(vix_payload, f, indent=2)
    except Exception as exc:
        print(f"  note: VIX tab unavailable ({exc}).")


if __name__ == "__main__":
    main()

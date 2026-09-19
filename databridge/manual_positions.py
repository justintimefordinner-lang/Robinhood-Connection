"""
manual_positions.py — price hand-entered positions with Robinhood market data.

Positions held somewhere Robinhood can't see (another broker, a 401k window, a
paper account) are entered on the dashboard's Settings page, which writes
them to APP_DATA_DIR/manual_positions.json with only the facts a broker can't
know: symbol, quantity, strike, expiration, what you paid or collected.

Each cycle this module reads that file, asks Robinhood for the underlying quote
and the option contract's own quote (mark + delta/theta/IV — the same market
data call robinhood_client makes for held contracts), and writes
APP_DATA_DIR/manual/snapshot.json in the exact shape export_to_app writes. The
dashboard merges every subfolder's snapshot, so the manual accounts appear in
the account switcher, the Combined view, Options, P&L and the Positions table
with no reader changes.

Input (written by the app, never edited here):

    {"version": 1, "accounts": [{
        "id": "manual-etrade", "label": "E*TRADE", "cash": 12000,
        "positions": [
          {"id": "…", "type": "stock",  "symbol": "AAPL", "qty": 100, "avgCost": 240, "openedAt": "2026-08-01"},
          {"id": "…", "type": "option", "symbol": "SOFI", "optionType": "put", "side": "short",
           "qty": 1, "strike": 16, "expiration": "2026-10-09", "premium": 0.69, "openedAt": "2026-09-18"}
        ]}]}

Strategy labels: a short put is a CSP, a long call a LEAP, a short call covered
by 100 shares/contract of the same name in the same manual account is a covered
call, a short+long pair at one expiration is a vertical spread, a long-dated
long put a hedge.

GOING EASY ON ROBINHOOD. There is no batch option quote: every contract is its
own request, and Robinhood rate-limits by account. So:
  * a contract's instrument id is looked up once and remembered for the life
    of the process — after that, a reprice is one request per contract, the
    same cost as a position actually held at Robinhood;
  * the default cadence is 5 minutes (MANUAL_PUSH_INTERVAL), not every snapshot;
  * while the market is closed nothing is re-quoted unless the positions file
    changed, since the marks aren't moving.

With no manual file, or no accounts in it, the output snapshot is removed so a
deleted account disappears from the dashboard.
"""
from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timezone
from typing import Any

MANUAL_FILE = "manual_positions.json"
OUT_DIR = "manual"
OUT_FILE = "snapshot.json"
EARNINGS_FILE = "earnings.json"
QUOTE_THROTTLE_SEC = 0.2  # same pause robinhood_client takes between chain quotes

# (symbol, expiration, strike, put|call) -> Robinhood option instrument id. None is
# remembered too: a contract that doesn't exist (typo'd strike) isn't re-searched
# every cycle. Cleared only by a restart.
_INSTRUMENT_IDS: dict[tuple[str, str, float, str], str | None] = {}
_last_input_mtime: float | None = None


def _dte(expiration: str) -> int | None:
    try:
        return (date.fromisoformat(expiration) - date.today()).days
    except ValueError:
        return None


def _to_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _unwrap(md: Any) -> dict[str, Any]:
    """robin_stocks wraps market data in a list (sometimes a list of lists)."""
    row = md
    while isinstance(row, list):
        if not row:
            return {}
        row = row[0]
    return row if isinstance(row, dict) else {}


def _instrument_id(rh, symbol: str, expiration: str, strike: float, option_type: str) -> str | None:
    key = (symbol, expiration, float(strike), option_type)
    if key in _INSTRUMENT_IDS:
        return _INSTRUMENT_IDS[key]
    found: str | None = None
    try:
        rows = rh.options.find_options_by_expiration_and_strike(
            symbol, expiration, str(strike), optionType=option_type, info=None
        )
        for r in rows or []:
            if isinstance(r, dict) and r.get("id"):
                found = r["id"]
                break
    except Exception as exc:  # noqa: BLE001 - one bad contract must not sink the account
        print(f"  note: couldn't look up {symbol} {expiration} {strike} {option_type} ({exc}).")
        return None  # not cached: a network blip deserves another try next cycle
    time.sleep(QUOTE_THROTTLE_SEC)
    _INSTRUMENT_IDS[key] = found
    if found is None:
        print(f"  note: Robinhood lists no {symbol} {expiration} {strike} {option_type}; valuing it at entry.")
    return found


def quote_contract(rh, symbol: str, expiration: str, strike: float, option_type: str) -> dict[str, Any]:
    """{mark, delta, theta, iv, prev_close} for one contract; {} when it can't
    be quoted (the caller then values the row at what was paid)."""
    oid = _instrument_id(rh, symbol, expiration, strike, option_type)
    if not oid:
        return {}
    try:
        market = _unwrap(rh.options.get_option_market_data_by_id(oid))
    except Exception:  # noqa: BLE001
        market = {}
    time.sleep(QUOTE_THROTTLE_SEC)
    if not market:
        return {}
    return {
        "id": oid,
        "mark": _to_float(market.get("mark_price") or market.get("adjusted_mark_price")),
        "delta": _to_float(market.get("delta")),
        "theta": _to_float(market.get("theta")),
        "iv": _to_float(market.get("implied_volatility")),
        "prev_close": _to_float(market.get("previous_close_price")),
    }


# Category (the shared classifier's vocabulary) -> the snapshot's option kind.
_KIND_FOR_CATEGORY = {
    "CSPs": "csp",
    "LEAPS": "leap-call",
    "Covered calls": "covered-call",
    "Put spreads": "put-spread",
    "Call spreads": "call-spread",
}


# --- input -------------------------------------------------------------------
def load_manual(data_dir: str) -> list[dict[str, Any]]:
    """Manual accounts from the app's file; [] when absent or malformed."""
    path = os.path.join(data_dir, MANUAL_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    accounts = doc.get("accounts") if isinstance(doc, dict) else None
    return [a for a in (accounts or []) if isinstance(a, dict) and a.get("id")]


def _clean_positions(acct: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    """Split one account's rows into (stocks, options), dropping anything
    unusable rather than failing the whole account on one bad row."""
    stocks: list[dict] = []
    options: list[dict] = []
    for p in acct.get("positions") or []:
        if not isinstance(p, dict):
            continue
        sym = str(p.get("symbol") or "").strip().upper()
        try:
            qty = float(p.get("qty") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if not sym or qty <= 0:
            continue
        if p.get("type") == "stock":
            try:
                avg = float(p.get("avgCost") or 0)
            except (TypeError, ValueError):
                avg = 0.0
            stocks.append({"id": p.get("id"), "symbol": sym, "qty": qty, "avgCost": avg, "openedAt": p.get("openedAt")})
        elif p.get("type") == "option":
            try:
                strike = float(p.get("strike"))
                premium = abs(float(p.get("premium") or 0))
                exp = str(p.get("expiration"))
                datetime.strptime(exp, "%Y-%m-%d")
            except (TypeError, ValueError):
                continue
            ot = "put" if str(p.get("optionType", "")).lower().startswith("p") else "call"
            side = "short" if str(p.get("side", "")).lower().startswith("s") else "long"
            options.append({
                "id": p.get("id"), "symbol": sym, "optionType": ot, "side": side, "qty": int(qty),
                "strike": strike, "expiration": exp, "premium": premium, "openedAt": p.get("openedAt"),
            })
    return stocks, options


# --- classification ------------------------------------------------------------
def categorize(stocks: list[dict], options: list[dict]) -> dict[str, str]:
    """{option id: category} using the same vocabulary export_to_app._kind_for
    reads: CSPs / LEAPS / Covered calls / Put spreads / Call spreads / Other."""
    shares: dict[str, float] = {}
    for s in stocks:
        shares[s["symbol"]] = shares.get(s["symbol"], 0.0) + s["qty"]

    # Verticals: a short and a long of the same type at one expiration.
    by_key: dict[tuple, list[dict]] = {}
    for o in options:
        by_key.setdefault((o["symbol"], o["optionType"], o["expiration"]), []).append(o)

    cats: dict[str, str] = {}
    for (sym, ot, _exp), legs in by_key.items():
        sides = {leg["side"] for leg in legs}
        if "short" in sides and "long" in sides:
            for leg in legs:
                cats[leg["id"]] = "Put spreads" if ot == "put" else "Call spreads"
            continue
        for leg in legs:
            if ot == "put" and leg["side"] == "short":
                cats[leg["id"]] = "CSPs"
            elif ot == "call" and leg["side"] == "long":
                cats[leg["id"]] = "LEAPS"
            elif ot == "call" and leg["side"] == "short":
                need = 100 * leg["qty"]
                if shares.get(sym, 0.0) >= need:
                    shares[sym] -= need
                    cats[leg["id"]] = "Covered calls"
                else:
                    cats[leg["id"]] = "Other"
            else:
                cats[leg["id"]] = "Other"  # a long put; _kind_for makes a hedge of a long-dated one
    return cats


# --- valuation ---------------------------------------------------------------
def _leg_pnl(row: dict[str, Any]) -> float:
    """Unrealized $ P/L of one mapped option row (long: mark − entry; short:
    entry − mark), per contract × 100 × qty. Mirrors lib/calc optionPnl."""
    entry = row.get("entryPerShare") or 0.0
    mark = row.get("mark") or 0.0
    qty = row.get("qty") or 0
    per_share = (mark - entry) if row.get("side") == "long" else (entry - mark)
    return per_share * 100 * qty


def structured_options_value(rows: list[dict[str, Any]]) -> float:
    """The options book valued by capital tied up, the same way the dashboard's
    Options page does (OptionsSummarySim.structuredValue):
        CSP            → collateral (strike × 100 × qty) + its P/L
        LEAP / hedge   → market value (long assets)
        covered call   → its P/L only (the shares carry the capital)
        vertical       → defined risk (strike width × 100 × contracts) + P/L
        anything else  → market value if long, P/L if short
    A short put is therefore never a negative number here."""
    total = 0.0
    spreads: dict[tuple, list[dict[str, Any]]] = {}
    for r in rows:
        kind = r.get("kind")
        if kind == "csp":
            total += (r.get("strike") or 0.0) * 100 * (r.get("qty") or 0) + _leg_pnl(r)
        elif kind in ("leap-call", "leap-put-hedge"):
            total += (r.get("mark") or 0.0) * 100 * (r.get("qty") or 0)
        elif kind == "covered-call":
            total += _leg_pnl(r)
        elif kind in ("put-spread", "call-spread"):
            spreads.setdefault((r.get("symbol"), r.get("optionType"), r.get("expiration")), []).append(r)
        elif r.get("side") == "long":
            total += (r.get("mark") or 0.0) * 100 * (r.get("qty") or 0)
        else:
            total += _leg_pnl(r)
    for legs in spreads.values():
        strikes = [leg.get("strike") or 0.0 for leg in legs]
        width = max(strikes) - min(strikes) if len(strikes) > 1 else 0.0
        contracts = min(leg.get("qty") or 0 for leg in legs) if legs else 0
        total += width * 100 * contracts + sum(_leg_pnl(leg) for leg in legs)
    return total


# --- earnings dates (only for tickers the roster feed hasn't covered) ---------
def _fill_missing_earnings(data_dir: str, tickers: list[str]) -> None:
    path = os.path.join(data_dir, EARNINGS_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            have = json.load(f)
    except (OSError, json.JSONDecodeError):
        have = {}
    missing = sorted(t for t in tickers if t not in have)
    if not missing:
        return
    try:
        import fetch_earnings
        fetch_earnings.main(["fetch_earnings.py", *missing])
    except Exception as exc:  # yfinance absent, network, etc. — the flag just stays off
        print(f"  note: earnings lookup skipped ({exc}).")


# --- main --------------------------------------------------------------------
def _nothing_to_do(path: str, out_path: str, market_open: bool) -> bool:
    """Off-hours the marks aren't moving, so skip the requests entirely unless
    the positions file changed (or there's no output yet)."""
    global _last_input_mtime
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = None
    unchanged = mtime is not None and mtime == _last_input_mtime
    _last_input_mtime = mtime
    return unchanged and not market_open and os.path.exists(out_path)


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    import export_to_app as ex
    import robinhood_client as rc

    data_dir = ex._app_data_dir()
    out_dir = os.path.join(data_dir, OUT_DIR)
    out_path = os.path.join(out_dir, OUT_FILE)

    accounts = load_manual(data_dir)
    if not accounts:
        # Nothing to price. Drop a stale output so a removed account goes away.
        if os.path.exists(out_path):
            os.remove(out_path)
            print("manual: no accounts — removed stale snapshot")
        return

    if _nothing_to_do(os.path.join(data_dir, MANUAL_FILE), out_path, ex._cc_market_open()):
        raise SystemExit("market closed and no manual positions changed — nothing to reprice")

    cleaned = {a["id"]: _clean_positions(a) for a in accounts}
    tickers: set[str] = set()
    for stocks, options in cleaned.values():
        tickers.update(s["symbol"] for s in stocks)
        tickers.update(o["symbol"] for o in options)

    rh = rc.get_client()
    stock_day = rc.get_stock_day(rh, sorted(tickers)) if tickers else {}

    # One quote per distinct contract, shared across accounts that hold the same one.
    quotes: dict[tuple, dict[str, Any]] = {}
    for _stocks, options in cleaned.values():
        for o in options:
            key = (o["symbol"], o["expiration"], o["strike"], o["optionType"])
            if key not in quotes:
                quotes[key] = quote_contract(rh, *key)

    history = ex.load_history(data_dir)
    today = date.today().isoformat()
    prices_as_of = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")

    app_accounts: list[dict[str, Any]] = []
    data_by_account: dict[str, dict[str, Any]] = {}
    for acct in accounts:
        acct_id = str(acct["id"])
        stocks, options = cleaned[acct_id]
        cats = categorize(stocks, options)
        try:
            cash = float(acct.get("cash") or 0)
        except (TypeError, ValueError):
            cash = 0.0

        equities = []
        for s in stocks:
            price = stock_day.get(s["symbol"], {}).get("price")
            equities.append(ex.map_equity({
                "ticker": s["symbol"], "quantity": s["qty"], "avg_price": s["avgCost"],
                "underlying_price": price if price is not None else s["avgCost"],
            }, stock_day))

        opts = []
        quoted = 0
        for o in options:
            q = quotes.get((o["symbol"], o["expiration"], o["strike"], o["optionType"]), {})
            if q.get("mark") is not None:
                quoted += 1
            signed_qty = -o["qty"] if o["side"] == "short" else o["qty"]
            row = ex.map_option({
                "symbol": o["id"], "ticker": o["symbol"],
                "put_call": "PUT" if o["optionType"] == "put" else "CALL",
                "quantity": signed_qty, "avg_price": o["premium"], "strike": o["strike"],
                "expiration": o["expiration"],
                "mark": q.get("mark"), "delta": q.get("delta"), "theta": q.get("theta"),
                "iv": q.get("iv"), "prev_close": q.get("prev_close"),
                # No quote for this contract (typo'd strike, already expired): value
                # it at what was paid so P&L reads flat, not $0.
                "market_value": o["premium"] * 100 * o["qty"],
                "created_at": str(o["openedAt"]) if o.get("openedAt") else None,
            }, stock_day.get(o["symbol"], {}).get("price"), stock_day)
            # export_to_app guesses the strategy from one leg's shape; here the
            # whole manual account is in view, so spreads and naked calls are known.
            cat = cats.get(o["id"], "Other")
            if cat in _KIND_FOR_CATEGORY:
                row["kind"] = _KIND_FOR_CATEGORY[cat]
            elif o["optionType"] == "put" and o["side"] == "long" and (_dte(o["expiration"]) or 0) >= 270:
                row["kind"] = "leap-put-hedge"
            else:
                row["kind"] = "other"
            row["id"] = f"{acct_id}:{o['id']}"
            opts.append(row)

        equity_value = sum((e["qty"] or 0) * (e["price"] or 0) for e in equities)
        options_value = structured_options_value(opts)
        # The account's value the way the rest of the app frames it: free cash
        # (the `cash` the user entered — beyond what secures the puts) + shares
        # + options by capital tied up. A short put counts as its collateral
        # plus its P/L, never as a negative buy-back liability.
        total = cash + equity_value + options_value
        points = ex.update_history(history, acct_id, total, today)

        app_accounts.append({
            "id": acct_id,
            "mask": "manual",
            "type": "manual",
            "brokerageType": "manual",
            "nickname": str(acct.get("label") or "Manual"),
            "isDefault": False,
        })
        data_by_account[acct_id] = {
            "summary": {
                "totalValue": ex._round(total),
                "equityValue": ex._round(equity_value),
                "optionsValue": ex._round(options_value),
                "cryptoValue": 0.0,
                "cash": ex._round(cash),
                "buyingPower": ex._round(cash),
                "optionsBuyingPower": ex._round(cash),
            },
            "equities": equities,
            "options": opts,
            "valueHistory": points,
        }
        print(f"manual: {acct.get('label')} — {len(equities)} stocks, {len(opts)} options, {quoted} contracts quoted")

    snapshot = ex.build_snapshot(app_accounts, data_by_account, prices_as_of)
    os.makedirs(out_dir, exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)
    os.replace(tmp, out_path)
    ex.save_history(data_dir, history)

    # Earnings dates the roster-driven feed would otherwise miss for these names.
    _fill_missing_earnings(data_dir, sorted({o["symbol"] for _s, os_ in cleaned.values() for o in os_}))


if __name__ == "__main__":
    main()

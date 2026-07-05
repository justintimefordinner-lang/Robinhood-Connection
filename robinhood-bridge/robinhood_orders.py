"""
robinhood_orders.py
=====================

Pulls Robinhood's full option + stock order history and reshapes it into the
same record formats schwab-bridge's sync_trade_history.py builds — so
closed_trades.py (100% broker-agnostic, unmodified/copied verbatim into this
folder) can reconstruct closed CSPs/LEAPs/spreads/covered-calls/stocks
without caring which broker the fills came from.

Two outputs, matching trade-history.json / transactions.json:

  get_option_order_records(rh) -> {account_id: [order_record, ...]}
      order_record = {orderId, enteredTime, legs: [{instruction, positionEffect,
      quantity, assetType, symbol, ticker, putCall, strike, expiration,
      fillPrice}, ...], fillPrice, symbol, ...}   — see closed_trades.py's
      _events_for_contract() for exactly what it reads.

  get_stock_transactions(rh) -> {account_id: [txn_record, ...]}
      txn_record = {"type": "TRADE", "tradeDate": ..., "transferItems": [
      {"instrument": {"assetType": "EQUITY", "symbol": ...}, "amount": signed
      shares, "price": ...}]}  — see closed_trades.py's
      _equity_events_from_txns().

DIFFERENCES FROM THE SCHWAB VERSION (read before trusting the P&L tabs):

  • No windowed backfill needed — robin_stocks' order-history calls already
    paginate through your ENTIRE account history in one logical call, so
    there's no 60-day API ceiling to work around. This module always pulls
    everything and upserts by order id.
  • No fee/commission data. Robinhood options/stock trades are commission-free,
    so unlike the Schwab bridge (which nets out per-contract fees from the
    transactions feed), realized P&L here is gross — there's no fee line to
    subtract. That matches reality for Robinhood, but if you ever see small
    regulatory fees (ORF/TAF) on a statement, they are NOT reflected here.
  • Option assignment/exercise cost basis is NOT reconstructed. Schwab's
    bridge derives assigned-stock cost basis from RECEIVE_AND_DELIVER
    transactions; robin_stocks has no clean equivalent feed for this. If
    shares in your account arrived via assignment rather than a plain buy
    order, the Stocks-closed tab's cost basis for that lot will be wrong or
    missing. Plain buy/sell round-trips are unaffected.
  • Short stock is not reconstructed (Robinhood wheel accounts are almost
    always long-only on equities, so this wasn't prioritized) — only BUY/SELL
    events are emitted; SELL_SHORT/BUY_TO_COVER never appear.
  • Robinhood's `average_price` on option orders is normalized here to a
    PER-SHARE figure (dividing by 100) to match Schwab's convention, which is
    what closed_trades.py expects. Spot-check your first few closed trades
    against Robinhood's own app before trusting the numbers at a glance.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


def _resolve_instrument_cache(rh) -> dict[str, dict[str, Any]]:
    """Populated lazily by _instrument() below; kept here so repeated legs on
    the same option contract only look it up once per run."""
    return {}


def _instrument(rh, option_id: str, cache: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if option_id in cache:
        return cache[option_id]
    try:
        data = rh.options.get_option_instrument_data_by_id(option_id) or {}
    except Exception:
        data = {}
    cache[option_id] = data
    return data


def _id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    return url.rstrip("/").rsplit("/", 1)[-1]


def _option_instruction(side: str, position_effect: str) -> str:
    side = (side or "").upper()
    effect = (position_effect or "").upper()
    if side == "BUY" and effect == "OPEN":
        return "BUY_TO_OPEN"
    if side == "SELL" and effect == "OPEN":
        return "SELL_TO_OPEN"
    if side == "BUY" and effect == "CLOSE":
        return "BUY_TO_CLOSE"
    if side == "SELL" and effect == "CLOSE":
        return "SELL_TO_CLOSE"
    # Fallback: guess from side alone if position_effect ever comes back blank.
    return "BUY_TO_OPEN" if side == "BUY" else "SELL_TO_OPEN"


def get_option_order_records(rh) -> dict[str, list[dict[str, Any]]]:
    account_id = _account_id(rh)
    try:
        orders = rh.orders.get_all_option_orders() or []
    except Exception as exc:
        print(f"  note: option order history unavailable ({exc})")
        return {account_id: []}

    cache: dict[str, dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    for o in orders:
        state = (o.get("state") or "").lower()
        processed_qty = float(o.get("processed_quantity") or 0)
        if state not in ("filled", "partially_filled") and processed_qty <= 0:
            continue  # cancelled/rejected/expired-unfilled — nothing traded

        legs_out = []
        for leg in o.get("legs", []) or []:
            option_id = leg.get("option_id") or _id_from_url(leg.get("option"))
            instrument = _instrument(rh, option_id, cache) if option_id else {}
            qty = float(leg.get("ratio_quantity") or 1) * processed_qty
            price = o.get("processed_premium")
            # processed_premium is Robinhood's TOTAL dollar amount for the whole
            # order (all legs, all contracts) — e.g. "Est credit" in the app,
            # not a per-share price. processed_qty counts CONTRACTS, and each
            # contract is 100 shares, so getting back to a true per-share price
            # (what closed_trades.py's *100*qty math expects) needs dividing by
            # both the contract count AND the 100-share multiplier. Dividing by
            # processed_qty alone left this 100x too high, which closed_trades.py
            # then multiplied by 100 again — a clean 100x overstatement on every
            # realized P&L figure. For multi-leg spreads this per-share figure is
            # still a simplification (processed_premium isn't split per leg) —
            # the spread-detection path in closed_trades.py works off
            # strike/expiration/side regardless, just the per-leg fill price used
            # in the P&L math may be less precise than a true per-leg execution
            # price.
            per_share = None
            if price is not None and processed_qty:
                try:
                    per_share = abs(float(price)) / (processed_qty * 100)
                except (TypeError, ZeroDivisionError):
                    per_share = None
            legs_out.append({
                "instruction": _option_instruction(leg.get("side", ""), leg.get("position_effect", "")),
                "positionEffect": (leg.get("position_effect") or "").upper() + "ING"
                    if leg.get("position_effect") else "",
                "quantity": qty,
                "assetType": "OPTION",
                "symbol": option_id or "",
                "fillPrice": per_share,
                "ticker": o.get("chain_symbol", ""),
                "putCall": (instrument.get("type") or "").upper(),
                "strike": _to_float(instrument.get("strike_price")),
                "expiration": instrument.get("expiration_date"),
            })

        first = legs_out[0] if legs_out else {}
        records.append({
            "orderId": o.get("id"),
            "enteredTime": o.get("created_at", "") or "",
            "fillPrice": first.get("fillPrice"),
            "symbol": first.get("ticker", ""),
            "legs": legs_out,
        })

    return {account_id: sorted(records, key=lambda r: r["enteredTime"])}


def get_stock_transactions(rh) -> dict[str, list[dict[str, Any]]]:
    account_id = _account_id(rh)
    try:
        orders = rh.orders.get_all_stock_orders() or []
    except Exception as exc:
        print(f"  note: stock order history unavailable ({exc})")
        return {account_id: []}

    txns: list[dict[str, Any]] = []
    for o in orders:
        state = (o.get("state") or "").lower()
        qty = float(o.get("cumulative_quantity") or 0)
        if state not in ("filled", "partially_filled") or qty <= 0:
            continue
        side = (o.get("side") or "").lower()
        price = _to_float(o.get("average_price"))
        symbol = o.get("symbol")
        if not symbol:
            symbol = _symbol_from_instrument_url(rh, o.get("instrument"))
        if not symbol or price is None:
            continue
        signed_qty = qty if side == "buy" else -qty
        txns.append({
            "type": "TRADE",
            "tradeDate": o.get("created_at", "") or "",
            "orderId": o.get("id"),
            "transferItems": [{
                "instrument": {"assetType": "EQUITY", "symbol": symbol},
                "amount": signed_qty,
                "price": price,
            }],
        })

    return {account_id: sorted(txns, key=lambda t: t["tradeDate"])}


_INSTRUMENT_SYMBOL_CACHE: dict[str, str] = {}


def _symbol_from_instrument_url(rh, url: str | None) -> str | None:
    if not url:
        return None
    if url in _INSTRUMENT_SYMBOL_CACHE:
        return _INSTRUMENT_SYMBOL_CACHE[url]
    try:
        data = rh.stocks.get_instrument_by_url(url) or {}
        sym = data.get("symbol")
    except Exception:
        sym = None
    if sym:
        _INSTRUMENT_SYMBOL_CACHE[url] = sym
    return sym


def _account_id(rh) -> str:
    try:
        profile = rh.profiles.load_account_profile() or {}
        acct_num = profile.get("account_number") or "0000"
    except Exception:
        acct_num = "0000"
    return f"rh-{acct_num}"


def _to_float(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None

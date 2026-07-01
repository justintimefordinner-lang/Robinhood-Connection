"""
sync_trade_history.py  (Robinhood bridge)
============================================

Builds and maintains data/trade-history.json and data/transactions.json from
your Robinhood order history, then rebuilds the closed-trade tabs
(csp-closed.json, leaps-closed.json, etc.) via closed_trades.py. READ-ONLY.

Unlike the Schwab bridge, there's no 60-day API ceiling to backfill around —
robin_stocks' order-history calls return your full account history in one
logical call (it paginates internally). So this always pulls everything and
upserts by order id; there's no separate --full/backfill mode to worry about.

Run:
    python sync_trade_history.py

Designed to run once a day after the close (same guidance as the Schwab
bridge) — NOT every 60 seconds. Keep it out of the tight auto_push loop;
call it from cron or a slower interval instead.

Needs APP_DATA_DIR set in .env (same folder as snapshot.json).

See robinhood_orders.py's docstring for what's NOT reconstructed (assignment
cost basis, fees — there are none on Robinhood — and short stock).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv

HISTORY_FILE = "trade-history.json"
TXNS_FILE = "transactions.json"


def _data_dir() -> str:
    d = os.environ.get("APP_DATA_DIR")
    if not d or not os.path.isdir(d):
        raise SystemExit("Set APP_DATA_DIR in .env to the app's data folder (with snapshot.json).")
    return d


def main() -> None:
    load_dotenv()
    import robinhood_client as rc
    import robinhood_orders as ro

    data_dir = _data_dir()
    path = os.path.join(data_dir, HISTORY_FILE)
    txns_path = os.path.join(data_dir, TXNS_FILE)

    store: dict[str, list[dict[str, Any]]] = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                store = json.load(f)
        except Exception:
            store = {}

    txns_store: dict[str, list[dict[str, Any]]] = {}
    if os.path.exists(txns_path):
        try:
            with open(txns_path, encoding="utf-8") as f:
                txns_store = json.load(f)
        except Exception:
            txns_store = {}

    rh = rc.get_client()

    print("Pulling full Robinhood option order history ...")
    fresh_orders = ro.get_option_order_records(rh)
    for aid, recs in fresh_orders.items():
        by_id = {r["orderId"]: r for r in store.get(aid, []) if r.get("orderId") is not None}
        for r in recs:
            if r.get("orderId") is not None:
                by_id[r["orderId"]] = r  # upsert
        store[aid] = sorted(by_id.values(), key=lambda r: r["enteredTime"])
        print(f"  ****{aid[-4:]}: {len(store[aid])} option order records")

    print("Pulling full Robinhood stock order history ...")
    fresh_txns = ro.get_stock_transactions(rh)
    for aid, recs in fresh_txns.items():
        by_id = {t.get("orderId"): t for t in txns_store.get(aid, []) if t.get("orderId") is not None}
        for t in recs:
            if t.get("orderId") is not None:
                by_id[t["orderId"]] = t
        txns_store[aid] = sorted(by_id.values(), key=lambda t: t["tradeDate"])
        print(f"  ****{aid[-4:]}: {len(txns_store[aid])} stock transaction records")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    print(f"Wrote {path}")

    with open(txns_path, "w", encoding="utf-8") as f:
        json.dump(txns_store, f, indent=2, ensure_ascii=False)
    print(f"Wrote {txns_path}")

    import closed_trades
    counts = closed_trades.write_closed(data_dir, store)
    print(
        f"Rebuilt closed tabs — CSPs: {counts['csp']}, LEAPs: {counts['leap']}, "
        f"spreads: {counts['spread']}, covered calls: {counts['covered']}, stocks: {counts['stock']}."
    )


if __name__ == "__main__":
    main()

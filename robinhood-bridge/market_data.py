"""
market_data.py
===============

Public market data that has nothing to do with your Robinhood account:
VIX / VIX3M / VIX9D / VVIX / SKEW, /ES and /NQ futures, and SPY history for
realized-vol math. Schwab's market-data API could quote all of these
directly ($VIX, $VIX3M, /ES, /NQ); Robinhood's retail API has no index or
futures quotes at all, so this module pulls the same figures from Yahoo
Finance via `yfinance` instead — free, no login, and already a dependency
here (fetch_earnings.py uses it too).

Used by am_report.py (regime block, stress-interval signals) and
export_to_app.py (the VIX tab). Nothing here touches your account — it's
pure public-data lookup, safe to call without being logged into Robinhood.
"""

from __future__ import annotations

from typing import Any

# Yahoo tickers for each CBOE series the app displays.
_YF_SYMBOLS = {
    "VIX": "^VIX",
    "VIX3M": "^VIX3M",
    "VIX9D": "^VIX9D",
    "VVIX": "^VVIX",
    "SKEW": "^SKEW",
}
_FUTURES_SYMBOLS = {"ES": "ES=F", "NQ": "NQ=F"}


def get_quotes(symbols: dict[str, str]) -> dict[str, dict[str, float | None]]:
    """symbols: {label: yahoo_ticker}. Returns {label: {"last":, "prevClose":}}.
    Best-effort per symbol — one bad ticker doesn't blank the others."""
    import yfinance as yf

    out: dict[str, dict[str, float | None]] = {}
    tickers = yf.Tickers(" ".join(symbols.values()))
    for label, yf_sym in symbols.items():
        try:
            info = tickers.tickers[yf_sym].fast_info
            last = info.get("last_price") or info.get("lastPrice")
            prev = info.get("previous_close") or info.get("previousClose")
            out[label] = {"last": float(last) if last is not None else None,
                           "prevClose": float(prev) if prev is not None else None}
        except Exception:
            out[label] = {"last": None, "prevClose": None}
    return out


def get_vix_family() -> dict[str, float | None]:
    """{"vix":, "vix3m":, "vix9d":, "vvix":, "skew":} — last price for each."""
    quotes = get_quotes(_YF_SYMBOLS)
    return {label.lower(): q["last"] for label, q in quotes.items()}


def get_futures() -> list[dict[str, Any]]:
    """[{"sym": "ES", "pct": <overnight % change>}, ...]; skips a future whose
    quote didn't come through rather than reporting a misleading 0%."""
    quotes = get_quotes(_FUTURES_SYMBOLS)
    out = []
    for label, q in quotes.items():
        last, prev = q["last"], q["prevClose"]
        if last is not None and prev:
            out.append({"sym": label, "pct": round((last / prev - 1) * 100, 2)})
    return out


def get_daily_closes(symbol: str, days: int = 420) -> list[float]:
    """Oldest-to-newest daily close prices for `symbol` over ~`days` calendar
    days. Used for SPY realized-vol (regime) and beta-vs-SPY (board scoring).
    Robinhood's own historicals (robinhood_client.get_price_history) cover
    per-name history; this yfinance path is only used where SPY/index data is
    needed independent of any Robinhood position."""
    import yfinance as yf

    period = "2y" if days > 400 else ("1y" if days > 100 else "6mo")
    try:
        hist = yf.Ticker(symbol).history(period=period, interval="1d")
    except Exception:
        return []
    if hist is None or hist.empty:
        return []
    return [float(c) for c in hist["Close"].tolist() if c is not None]

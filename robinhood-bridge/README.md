# robinhood-bridge

The sole data bridge for the app now — reads your Robinhood account
(read-only) and public market data, writes plain JSON into the app's `data/`
folder, never places a trade. Replaces schwab-bridge entirely; you can
delete that folder (and its systemd service) once this is running.

Uses [`robin_stocks`](https://github.com/jmfernandes/robin_stocks) for your
account data (an unofficial library that logs in the way the mobile app
does — there's no official public API for personal Robinhood accounts) and
`yfinance` for public market data Robinhood doesn't expose at all (VIX
family, /ES //NQ futures). Your credentials stay in your local `.env`; only
derived JSON leaves this folder.

## Setup

```bash
cd robinhood-bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env       # then edit .env with your Robinhood login + APP_DATA_DIR
python export_to_app.py    # first run: type the MFA code it prompts for
```

For unattended (systemd/cron, no terminal) operation, set
`ROBINHOOD_TOTP_SECRET` — see the comment in `.env.example`.

## What each script does

| File | Role |
|---|---|
| `robinhood_client.py` | Authenticated entry point — login, positions, price history, option chains, VIX-band framework. |
| `robinhood_orders.py` | Order-history adapter — reshapes Robinhood's order feed into the same record shapes closed_trades.py expects. |
| `market_data.py` | Public market data Robinhood doesn't have at all: VIX/VIX3M/VIX9D/VVIX/SKEW, /ES //NQ futures (via yfinance). |
| `export_to_app.py` | Core positions/summary feed → `snapshot.json`, `value-history.json`, `vix.json`. |
| `research_sync.py` | Approved-universe technicals (Bollinger/RSI/MACD) + setup signals → `research.json`. |
| `am_report.py` | Morning Brief engine — regime gate, CSP board, put ladders, gamma walls, movers → `am_report.json`. |
| `fetch_earnings.py` | Next-earnings dates via yfinance → `earnings.json` (broker-agnostic, unchanged from the Schwab bridge). |
| `sync_trade_history.py` | Full option + stock order history → `trade-history.json`/`transactions.json`, then rebuilds closed-trade tabs. |
| `closed_trades.py` | Pure-Python FIFO reconstruction of closed CSPs/LEAPs/spreads/covered-calls/stocks (unchanged from the Schwab bridge — 100% broker-agnostic). |
| `indicators.py` | Bollinger/RSI/MACD math + setup classifier (unchanged — pure functions, no network). |
| `auto_push.py` | Scheduler — runs app/research/am_report/ladder exports on independent timers. |

## Running it

```bash
python auto_push.py                 # long-running loop (or run as a systemd service)
python sync_trade_history.py        # run separately, once a day (see its docstring)
```

## Known gaps vs. the Schwab bridge (read before trusting a number)

- **Option-chain call volume.** Schwab serves an entire multi-expiration
  chain in one HTTP call; Robinhood's retail API needs one call per strike.
  `robinhood_client.get_option_chain()` narrows this to a single expiration,
  and for puts, a %-OTM price band aimed at the -0.15..-0.30 delta zone the
  screen/gate actually use (`put_pct_band`, default 3%-25% OTM) instead of
  just the strikes nearest the money — see that function's docstring. Still,
  a full Morning Brief run across ~56 approved names adds up. Trim your
  approved roster (`data/approved-stocks.json`), or tighten `strike_count`/
  `put_pct_band`, if this feels slow or you see errors that look like
  rate-limiting.
- **Robinhood is an unofficial, undocumented API from `robin_stocks`'
  perspective.** Field names have shifted across versions before, and
  Robinhood can throttle or block unusual call volume without warning. If
  something throws a `KeyError` or empty result, print one raw payload and
  adjust the `.get(...)` key names — the pipeline is defensive on purpose
  (missing fields degrade to `None`/`0` rather than crashing a whole run).
- **No fee data.** Robinhood options/stock trades are commission-free, so
  realized P&L in the closed-trade tabs is gross (no fee line to net out —
  unlike the Schwab bridge, which subtracts commissions from the
  transactions feed).
- **Assignment cost basis isn't reconstructed.** If shares landed in your
  account via option assignment rather than a plain buy order, that lot's
  cost basis in the Stocks-closed tab may be wrong or missing. Plain
  buy/sell round-trips are fine.
- **Short stock isn't reconstructed** (only BUY/SELL are emitted, no
  SELL_SHORT/BUY_TO_COVER) — fine for a wheel-strategy account, which is
  almost always long-only on equities.
- **VIX/futures come from Yahoo, not Robinhood.** Robinhood has no index or
  futures quotes at all, so `market_data.py` pulls those from `yfinance`
  instead. Everything else (positions, orders, option chains, stock history)
  comes from your actual Robinhood account.

## Migrating from schwab-bridge

Point `APP_DATA_DIR` in this folder's `.env` at the same `portfolio-app/data`
folder the Schwab bridge used — the file names and shapes are identical, so
the app doesn't need any changes. Stop/disable the `schwab-bridge` systemd
service before starting this one so they don't both write at once.

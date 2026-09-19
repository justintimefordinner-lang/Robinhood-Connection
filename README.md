# Wheel Toolkit

A self-hosted options-wheel trading dashboard. Two independent halves that talk
only through a folder of JSON files on disk:

- **`appfiles/`** — a Next.js 16 dashboard (Home, Options, Stocks, P&L,
  VIX, Morning Brief, Research). This is what you see.
- **`databridge/`** — a Python program that reads your Robinhood
  account + public market data and writes the JSON the app renders. This is
  read-only; it can't trade.

---

## Install (Docker — a Raspberry Pi, or any computer)

One command. It pulls two prebuilt images and starts them; nothing is compiled
and no repository is cloned. Needs Docker with Compose v2.

```bash
curl -fsSL https://raw.githubusercontent.com/justintimefordinner-lang/Robinhood-Connection/main/install.sh | bash
```

Open `http://<that machine>:3001`, then **Settings → Robinhood connection** and
enter your sign-in. Robinhood sends an approval prompt to your phone; approve it
and live data starts within a minute. Everything lives in `~/portfolio-robinhood`.

Update later:

```bash
cd ~/portfolio-robinhood && docker compose pull && docker compose up -d
```

**Moving from the older pm2 / systemd install?** Stop the old processes, then
run the installer with `PORTFOLIO_MIGRATE_FROM` pointing at your old checkout.
It carries over your data, your settings and your saved Robinhood session, so
the new bridge starts already logged in:

```bash
pm2 stop appfiles databridge databridge-history databridge-earnings && pm2 save
```

```bash
curl -fsSL https://raw.githubusercontent.com/justintimefordinner-lang/Robinhood-Connection/main/install.sh | PORTFOLIO_MIGRATE_FROM=~/Robinhood-Connection bash
```

> The step-by-step guides further down ([SETUP_GUIDE.md](SETUP_GUIDE.md),
> [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md), [INSTALL.md](INSTALL.md)) describe
> the older run-from-a-checkout install. They still work for development, but the
> daily trade-history and earnings jobs now run inside `auto_push.py`, and the
> pm2 / systemd unit files are gone.

## See the dashboard in 60 seconds (no Robinhood account needed)

```bash
cd appfiles
npm install
npm run dev
```

Open <http://localhost:3001> and click **Example** in the header. The app loads a
complete built-in demo portfolio (`lib/example.ts`) and every screen populates —
the fastest way to see exactly how it looks and behaves.

> Requires **Node.js 20.9+** (Next.js 16). Production: `npm run build && npm start`.

## Wire it to your real account

1. Set up `databridge/` (see its README) and create your `.env` from
   `.env.example`.
2. Point the bridge's `APP_DATA_DIR` at **`appfiles/data/`**.
3. Run `python auto_push.py` (live snapshot/research/Morning Brief on a
   schedule) and, separately, `python sync_trade_history.py` once a day for
   closed-trade history — the app will render your live positions.

## Running it on a Raspberry Pi

See **[`RASPBERRY_PI_SETUP.md`](RASPBERRY_PI_SETUP.md)** for a full walkthrough
(Node/arm64 setup, swap for `next build`, systemd services + timers for
unattended 24/7 operation). Superseded by the Docker install above.

---

## 🔒 Security — read before you push anywhere

This repo is structured so secrets **cannot** ride along, but it's on you to keep
it that way:

- **Never commit** `.env` or any Robinhood session/token cache. `.env` is
  gitignored at the root and in `databridge/`. Your Robinhood
  credentials live only in your local `.env`.
- `appfiles/data/*.json` (your real holdings) is gitignored too — only the
  synthetic Example dataset is in the code.
- If you fork this **public**, double-check `git status` shows none of the above
  before your first push.

---

## Notes

- Personal project, provided as-is. Not financial advice.
- Maintained by [justintimefordinner-lang](https://github.com/justintimefordinner-lang)
  (Hanks Made Investments), building on the upstream
  [Jimmydaux/JerStock](https://github.com/Jimmydaux/JerStock).
- Robinhood access goes through [`robin_stocks`](https://github.com/jmfernandes/robin_stocks),
  an unofficial library — see `databridge/README.md` for its known gaps
  and rate-limit considerations before relying on this for anything time-sensitive.

# Running the Wheel Toolkit on a Raspberry Pi (4/5, 64-bit Raspberry Pi OS)

Covers: the Next.js dashboard + the Robinhood bridge (Schwab bridge removed —
Robinhood is now the sole data source), all running under **PM2** so they
start on boot and restart on crash.

Everything below assumes the project unpacked at `~/JerStock` (e.g.
`/home/pi/JerStock`, or `/home/jimmydaux/JerStock` if that's your username —
whatever `whoami` and `pwd` give you). Adjust paths if yours differ — the
`cwd` fields in `ecosystem.config.js` at the repo root hardcode an absolute
path and need to match wherever you actually unpacked the project.

```
~/JerStock/
├── appfiles/
├── databridge/
└── ecosystem.config.js
```

(If you still have a `schwab-bridge/` folder from an earlier setup, you can
delete it — nothing in this guide depends on it anymore. Same goes for the
old `systemd/` folder if you're migrating from a systemd-based install: once
PM2 is running the three services below, `sudo systemctl disable --now
appfiles databridge databridge-history.timer` and remove the unit files from
`/etc/systemd/system/`.)

---

## 1. One-time OS prep

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git python3-venv python3-pip build-essential
```

**Node.js**: the app needs Node 20.9+ for Next.js 16. Use NodeSource's arm64
build (Raspberry Pi OS's own apt repo is usually behind):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirm v20.x, arm64
```

**PM2**: install it globally once Node is in place — this is what runs and
supervises everything below.

```bash
sudo npm install -g pm2
pm2 -v
```

**Swap** (Pi 4 with 4GB or less, or Pi 3): `next build` can use more RAM than
the default 100MB swap file and get OOM-killed mid-build. Bump it:

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

Pi 5 (8GB) or Pi 4 (8GB) generally builds fine without this, but the headroom
doesn't hurt.

---

## 2. Dashboard (`appfiles/`)

```bash
cd ~/JerStock/appfiles
npm install
npm run build     # the step swap matters for; give it a few minutes
npm run start     # quick manual check — Ctrl+C once you've confirmed it works
```

Visit `http://<pi-ip>:3001` from another machine on your LAN (see the `PORT`
in `ecosystem.config.js` — it's set to 3001, not Next's default 3000).

**Run under PM2**, using the `ecosystem.config.js` at the repo root (it
already defines all four processes — dashboard, live-data loop, daily
history sync, daily earnings refresh). Open it first and fix the `cwd` paths
if your checkout isn't at `/home/jimmydaux/JerStock`:

```bash
cd ~/JerStock
nano ecosystem.config.js   # update the four "cwd" lines to your actual path
```

Then start just the dashboard app by name:

```bash
pm2 start ecosystem.config.js --only appfiles
pm2 logs appfiles
```

Rebuilding after code changes: `npm run build` (inside `appfiles/`) then
`pm2 restart appfiles`.

---

## 3. Robinhood bridge (`databridge/`)

```bash
cd ~/JerStock/databridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
nano .env   # fill in ROBINHOOD_USERNAME / ROBINHOOD_PASSWORD, and:
            # APP_DATA_DIR=/home/<you>/JerStock/appfiles/data
```

**First-time auth**, interactively over SSH:

```bash
python export_to_app.py
```

It'll prompt for the 6-digit MFA code the first time, then cache the
session. For **fully unattended** PM2 operation (no one there to type a code
when the session eventually expires), set `ROBINHOOD_TOTP_SECRET` in `.env`
— see the comment in `.env.example` for how to get that secret from
Robinhood's security settings.

**Run the live-data loop under PM2** (app snapshot + research + Morning
Brief + ladder refresh — `auto_push.py` handles all four on its own internal
timers, see `databridge/README.md`):

```bash
cd ~/JerStock
pm2 start ecosystem.config.js --only databridge
pm2 logs databridge
```

**Run the daily trade-history sync and earnings refresh** — these are the
two oneshot jobs. Unlike the always-on `databridge` process, PM2 doesn't
"start" these in the usual sense; the `cron_restart` schedule baked into
`ecosystem.config.js` (`databridge-history` at 20:15, `databridge-earnings`
at 20:20, Mon–Fri) fires them and PM2 leaves them stopped in between. You
still need to register them once so PM2 knows about the schedule:

```bash
pm2 start ecosystem.config.js --only databridge-history,databridge-earnings
pm2 logs databridge-history
```

> Those cron times are evaluated in whatever timezone the Pi's system clock
> is set to. Simplest fix: set it to America/New_York
> (`sudo raspi-config` → Localisation → Timezone) — the schedule in
> `ecosystem.config.js` already assumes local ET, shortly after market
> close.
>
> Caveat vs. the old systemd timers: PM2's `cron_restart` has no
> `Persistent=true` equivalent — if the Pi is off or rebooting at the
> scheduled time, that day's run is simply skipped rather than catching up
> on next boot.

---

## 4. Make it survive reboots

PM2 doesn't restart your apps after a reboot unless you tell it to. Once all
four processes above show `online`/`stopped` (not `errored`) in `pm2 list`,
lock in the current process list and generate a startup hook:

```bash
pm2 save
pm2 startup
```

`pm2 startup` prints one `sudo env PATH=... pm2 startup systemd -u <you>
--hp /home/<you>` command tailored to your user — copy and run exactly that
line (don't just re-run `pm2 startup` and expect it to apply itself). After
a `sudo reboot`, `pm2 list` should show all four processes back up without
you doing anything.

If you ever add or edit an app in `ecosystem.config.js`, re-run `pm2 save`
so the new process list persists across the next reboot.

---

## 5. A word on call volume / rate limits

Robinhood's API is unofficial and undocumented from `robin_stocks`' side —
unlike Schwab, there's no single batched call for a full option chain, so
the Morning Brief (`am_report.py`) makes several hundred HTTP calls per full
run across a ~56-name approved roster. The defaults (30-min full-report
interval, 5-min ladder refresh, small per-call throttle) are deliberately
conservative. If you see errors that look like throttling, or just want a
lighter footprint on a Pi:

- Trim your approved roster (`data/approved-stocks.json`) — fewer names,
  fewer calls, linearly.
- Lengthen `AM_REPORT_PUSH_INTERVAL` / `AM_LADDER_PUSH_INTERVAL` in
  `databridge/.env`.
- See `robinhood_client.get_option_chain()`'s docstring for the specific
  tradeoffs it makes vs. the Schwab version.

---

## 6. Optional: reverse proxy / stable hostname

```bash
sudo apt install -y avahi-daemon   # mDNS, usually on by default
```

Raspberry Pi OS already answers on `raspberrypi.local`; rename via
`sudo raspi-config` → System Options → Hostname for something more specific.

For HTTPS/subpath routing, nginx in front:

```bash
sudo apt install -y nginx
```

```nginx
# /etc/nginx/sites-available/jerstock
server {
    listen 80;
    server_name wheel.local;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/jerstock /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. Sanity-check checklist

- [ ] `pm2 list` shows `appfiles` and `databridge` as `online`, and
      `databridge-history` / `databridge-earnings` as `stopped` (expected —
      they only wake up on their cron schedule)
- [ ] `curl -s localhost:3001 | head` returns HTML
- [ ] `data/snapshot.json` timestamp (`meta.generatedAt`) is recent
- [ ] `data/am_report.json` exists and `meta.asOf` is recent (after a market-hours run)
- [ ] `pm2 logs databridge --lines 50` shows no repeating auth or rate-limit errors
- [ ] `pm2 describe databridge-history` shows the `cron_restart` schedule you expect
- [ ] `pm2 list` still shows everything `online` after `sudo reboot` (confirms
      `pm2 save` + `pm2 startup` actually took effect)

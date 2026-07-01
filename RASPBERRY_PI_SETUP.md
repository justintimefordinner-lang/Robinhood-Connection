# Running the Wheel Toolkit on a Raspberry Pi (4/5, 64-bit Raspberry Pi OS)

Covers: the Next.js dashboard + the Robinhood bridge (Schwab bridge removed —
Robinhood is now the sole data source), all running as systemd services that
survive reboots.

Everything below assumes the default `pi` user and the project unpacked at
`/home/pi/JerStock`. Adjust paths if yours differ — the systemd unit
files in `systemd/` hardcode that path.

```
/home/pi/JerStock/
├── portfolio-app/
└── robinhood-bridge/
```

(If you still have a `schwab-bridge/` folder from an earlier setup, you can
delete it along with its systemd service — nothing in this guide depends on
it anymore.)

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

## 2. Dashboard (`portfolio-app/`)

```bash
cd /home/pi/JerStock/portfolio-app
npm install
npm run build     # the step swap matters for; give it a few minutes
npm run start      # quick manual check before wiring up systemd
```

Visit `http://<pi-ip>:3000` from another machine on your LAN.

**Run as a service:**

```bash
sudo cp systemd/portfolio-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now portfolio-app
journalctl -u portfolio-app -f
```

Rebuilding after code changes: `npm run build` then
`sudo systemctl restart portfolio-app`.

---

## 3. Robinhood bridge (`robinhood-bridge/`)

```bash
cd /home/pi/JerStock/robinhood-bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
nano .env   # fill in ROBINHOOD_USERNAME / ROBINHOOD_PASSWORD, and:
            # APP_DATA_DIR=/home/pi/JerStock/portfolio-app/data
```

**First-time auth**, interactively over SSH:

```bash
python export_to_app.py
```

It'll prompt for the 6-digit MFA code the first time, then cache the
session. For **fully unattended** systemd operation (no one there to type a
code when the session eventually expires), set `ROBINHOOD_TOTP_SECRET` in
`.env` — see the comment in `.env.example` for how to get that secret from
Robinhood's security settings.

**Run the live-data loop as a service** (app snapshot + research + Morning
Brief + ladder refresh, each on its own timer — see `robinhood-bridge/README.md`):

```bash
sudo cp ../systemd/robinhood-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now robinhood-bridge
journalctl -u robinhood-bridge -f
```

**Run the daily trade-history sync** as a separate timer (this one pulls
your full order history — fine once a day, not something to run every
minute):

```bash
sudo cp ../systemd/robinhood-history.service /etc/systemd/system/
sudo cp ../systemd/robinhood-history.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now robinhood-history.timer
systemctl list-timers robinhood-history.timer   # confirm next run time
```

> The timer's `OnCalendar` is in UTC and doesn't auto-adjust for ET
> daylight saving — see the comment in `systemd/robinhood-history.timer`.
> Simplest fix: set the Pi's own timezone to America/New_York
> (`sudo raspi-config` → Localisation → Timezone) and change the schedule
> to local time.

---

## 4. A word on call volume / rate limits

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
  `robinhood-bridge/.env`.
- See `robinhood_client.get_option_chain()`'s docstring for the specific
  tradeoffs it makes vs. the Schwab version.

---

## 5. Optional: reverse proxy / stable hostname

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
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/jerstock /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. Sanity-check checklist

- [ ] `systemctl status portfolio-app` → active (running)
- [ ] `curl -s localhost:3000 | head` returns HTML
- [ ] `data/snapshot.json` timestamp (`meta.generatedAt`) is recent
- [ ] `data/am_report.json` exists and `meta.asOf` is recent (after a market-hours run)
- [ ] `journalctl -u robinhood-bridge` shows no repeating auth or rate-limit errors
- [ ] `systemctl list-timers robinhood-history.timer` shows a sane next-run time
- [ ] Services come back up after `sudo reboot`

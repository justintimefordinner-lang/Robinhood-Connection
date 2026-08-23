# Robinhood Connection — Setup Guide

A self-hosted options-wheel trading dashboard for your Robinhood account.

**Repository:** <https://github.com/justintimefordinner-lang/Robinhood-Connection>

---

## The easiest way to do this: let Claude drive

You do not need to understand any of the commands in this guide.

1. Install **Claude Code** (`claude.ai/code`) on the computer you want to set this up from.
2. Start Claude Code and **give it this file.**
3. Say: *"Set up the Robinhood Connection dashboard for me using this guide."*
4. Answer Claude's questions as they come and paste back anything it asks to see.

Claude will clone the repository, install what's missing, create your configuration,
walk you through the Robinhood login, and start everything running. Every step below is
written so Claude can follow it exactly — and so you can do it by hand if you prefer.

> **One rule, whichever way you go:** never paste your Robinhood password into a chat
> window, a public issue, or anywhere other than the `.env` file on your own machine.
> Claude will tell you where to type it; it never needs to see it.

---

## What you are setting up

Two halves that only ever talk through a folder of JSON files on disk:

| Piece | What it is | What it does |
|---|---|---|
| **`appfiles/`** | A Next.js dashboard | Everything you look at — Portfolio, Stocks, Options, P&L, VIX, Morning Brief, Research |
| **`databridge/`** | A Python program | Reads your Robinhood account plus public market data and writes the JSON the dashboard renders |

**The bridge is read-only. It cannot place, modify, or cancel a trade.** It only reads
positions and market data.

### Pick where it runs

- **Raspberry Pi (recommended)** — runs 24/7, so the Morning Brief and live data are always
  current, and you can open the dashboard from your phone on the same network. → *Path A*
- **Your normal computer** — nothing extra to buy; data refreshes only while your machine is
  awake and the program is running. → *Path B*

You can start on a computer and move to a Pi later; the setup is the same.

---

## Before you start

You will need:

- A **Robinhood account** with **Authenticator-app two-factor** enabled
  (Robinhood → Account → Security). SMS two-factor will not work for unattended running.
- **Node.js 20.9 or newer** — the dashboard requires it.
- **Python 3.10 or newer** — the bridge requires it.
- **Git**.

To check what you already have:

```bash
node -v
python3 --version
git --version
```

---

## Try it first — no account needed

Before wiring up anything real, you can see the whole dashboard with a built-in demo
portfolio:

```bash
git clone https://github.com/justintimefordinner-lang/Robinhood-Connection.git
cd Robinhood-Connection/appfiles
npm install
npm run dev
```

Open <http://localhost:3001> and click **Example** in the header. Every screen fills with a
complete synthetic portfolio. Nothing touches Robinhood, and no credentials are involved.

Press `Ctrl+C` in the terminal to stop when you have seen enough.

---

## Path A — Raspberry Pi (always on)

Tested on a Raspberry Pi 4 or 5 running 64-bit Raspberry Pi OS.

### A1. Prepare the system

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git python3-venv python3-pip build-essential
```

Install Node 20 from NodeSource — the version in Raspberry Pi OS's own repository is
usually too old:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v      # expect v20.x
```

Install PM2, which keeps everything running and restarts it on boot:

```bash
sudo npm install -g pm2
```

**If your Pi has 4 GB of RAM or less**, give it more swap so the dashboard build does not
run out of memory:

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### A2. Get the code

```bash
cd ~
git clone https://github.com/justintimefordinner-lang/Robinhood-Connection.git
cd Robinhood-Connection
```

### A3. Build the dashboard

```bash
cd ~/Robinhood-Connection/appfiles
npm install
npm run build          # takes several minutes on a Pi — this is normal
```

### A4. Set up the bridge

```bash
cd ~/Robinhood-Connection/databridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
nano .env
```

Fill in these four values, then save with `Ctrl+O`, `Enter`, `Ctrl+X`:

```ini
ROBINHOOD_USERNAME=your_email@example.com
ROBINHOOD_PASSWORD=your_password
ROBINHOOD_TOTP_SECRET=            # see "Two-factor" below — required for 24/7 running
APP_DATA_DIR=/home/YOUR_USERNAME/Robinhood-Connection/appfiles/data
```

Replace `YOUR_USERNAME` with what `whoami` prints.

### A5. First login

```bash
cd ~/Robinhood-Connection/databridge
.venv/bin/python export_to_app.py
```

If `ROBINHOOD_TOTP_SECRET` is blank, it will ask for the 6-digit code from your
authenticator app. When it finishes you should see:

```
Wrote /home/.../appfiles/data/snapshot.json  (1 account(s), N positions).
```

That file is your dashboard's data. If you see it, the hard part is done.

### A6. Start everything

Open the process definitions and correct the paths to match your username:

```bash
cd ~/Robinhood-Connection
nano ecosystem.config.js     # update every "cwd" and "script" path
```

Then:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup                  # run the command it prints back to you
```

Check the status:

```bash
pm2 list
```

### A7. Open it

From any device on the same network:

```
http://<your-pi-ip>:3001
```

Find the address with `hostname -I`.

---

## Path B — Your own computer

Works on macOS, Linux, and Windows (use PowerShell, or WSL if you prefer Linux commands).

### B1. Get the code

```bash
git clone https://github.com/justintimefordinner-lang/Robinhood-Connection.git
cd Robinhood-Connection
```

### B2. Set up the bridge

```bash
cd databridge
python3 -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env               # Windows PowerShell: copy .env.example .env
```

Open `.env` in any text editor and fill in:

```ini
ROBINHOOD_USERNAME=your_email@example.com
ROBINHOOD_PASSWORD=your_password
ROBINHOOD_TOTP_SECRET=
APP_DATA_DIR=/full/path/to/Robinhood-Connection/appfiles/data
```

`APP_DATA_DIR` must be the **full, absolute** path — on Windows it looks like
`C:\Users\you\Robinhood-Connection\appfiles\data`.

### B3. First login

```bash
python export_to_app.py
```

Enter your 6-digit authenticator code when asked. Look for the `Wrote ... snapshot.json`
line.

### B4. Start the dashboard

In a **second** terminal:

```bash
cd Robinhood-Connection/appfiles
npm install
npm run dev
```

Open <http://localhost:3001>.

### B5. Keep the data fresh

Back in the first terminal, leave this running whenever you want live data:

```bash
cd Robinhood-Connection/databridge
python auto_push.py
```

It refreshes your positions about once a minute and rebuilds the Morning Brief and research
screens on their own slower schedules. Closing the terminal stops the updates; the dashboard
keeps showing the last data it received.

Once a day, for closed-trade history and the P&L page:

```bash
python sync_trade_history.py
```

---

## Two-factor: the TOTP secret

For a Pi that runs unattended, the bridge needs to generate its own login codes — otherwise
it stops the first time the session expires and nobody is there to type a code.

1. In Robinhood: **Account → Security → Two-Factor Authentication → Authenticator App**.
2. When it shows the QR code, choose **"Can't scan it?"** or **"Enter code manually"**.
3. Copy the long string of letters and numbers it shows you. That is the *secret key* — not
   the 6-digit code that changes every 30 seconds.
4. Put it in `.env` as `ROBINHOOD_TOTP_SECRET=...`.

If you are running on your own computer and are happy to type a code occasionally, you can
leave this blank.

---

## Checking that it worked

**The bridge is pulling data** — this should print a recent timestamp and your tickers:

```bash
python3 -c "
import json
d = json.load(open('appfiles/data/snapshot.json'))
print('generated:', d['meta']['generatedAt'])
for acct, v in d['data'].items():
    print('stocks :', [e['symbol'] for e in v['equities']])
    print('options:', sorted({o['symbol'] for o in v['options']}))
"
```

**The dashboard is live** — open it and check that the Portfolio page shows your real total
value rather than the demo numbers. The **Example** button in the header toggles between
your data and the built-in demo at any time.

---

## Day-to-day

**Getting updates:**

```bash
cd ~/Robinhood-Connection
git pull
cd appfiles && npm run build      # only needed if the dashboard changed
pm2 restart all                   # Pi; on a laptop just restart the two commands
```

Two things that trip everyone up at least once:

- **Changed the bridge?** Restart it. A running Python process keeps the old code in memory,
  so `git pull` alone changes nothing.
- **Changed the dashboard?** Rebuild it. Next.js compiles ahead of time, so new screens will
  not appear until `npm run build` runs.

---

## When something is wrong

| What you see | What it means | What to do |
|---|---|---|
| Dashboard shows demo data | The **Example** toggle is on, or no snapshot exists | Click **Example** in the header; check that `appfiles/data/snapshot.json` exists |
| Data is stuck at an old time | The bridge stopped or its login expired | `pm2 logs databridge` (or look at the terminal); log in again if asked |
| `Login failed` / MFA errors | Wrong password, or two-factor is not the authenticator app | Recheck `.env`; switch Robinhood to an authenticator app and set `ROBINHOOD_TOTP_SECRET` |
| `APP_DATA_DIR does not exist` | The path in `.env` is wrong | Use the full absolute path to `appfiles/data` |
| Build is killed on a Pi | Out of memory | Add swap (step A1) and build again |
| Morning Brief is empty | It only rebuilds on trading days | Normal on a weekend — it keeps the last board |

Stuck on something not listed? Give Claude this guide plus whatever the terminal printed,
and it will work out what happened.

---

## Keeping your account safe

- Your credentials live **only** in `databridge/.env` on your own machine. That file is
  git-ignored and never leaves the computer.
- `appfiles/data/*.json` holds your real positions and is git-ignored too. Only the synthetic
  Example dataset ships in the repository.
- **The bridge cannot trade.** It reads positions and market data; there is no order path in
  the code at all.
- If you fork this repository publicly, run `git status` before your first push and confirm
  neither `.env` nor anything under `appfiles/data/` is listed.

---

*Not financial advice. This is a personal tool provided as-is — see LICENSE.md.*

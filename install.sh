#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Portfolio (Robinhood) — one-line installer
#
#  Usage (this is the whole install):
#
#    curl -fsSL https://raw.githubusercontent.com/justintimefordinner-lang/Robinhood-Connection/main/install.sh | bash
#
#  Downloads the compose file, writes a settings file, and starts the stack
#  from prebuilt images. Nothing is compiled. No repository is cloned.
#
#  Safe to re-run: it never overwrites an existing .env, and never overwrites
#  anything already in data/ or bridge-state/.
#
#  Moving from the old pm2 / systemd install on the same machine? Stop the old
#  processes first, then point the installer at the old checkout:
#
#    curl -fsSL …/install.sh | PORTFOLIO_MIGRATE_FROM=~/Robinhood-Connection bash
#
#  That carries over your data, your settings, and — the part that matters —
#  your saved Robinhood session (~/.tokens), so the new bridge starts already
#  logged in instead of sending a new approval prompt to your phone.
#
#  Knobs (environment variables, all optional):
#    PORTFOLIO_DIR           where to install      (default ~/portfolio-robinhood)
#    PORTFOLIO_REPO_RAW      where to fetch the compose file from — a fork, or a
#                            branch for testing    (default this repo's main)
#    PORTFOLIO_MIGRATE_FROM  an existing Robinhood-Connection checkout to carry over
#
#  The whole script is one function called on the last line, so a download
#  that is cut off part-way runs nothing at all.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

main() {
  local REPO_RAW DIR TZ_GUESS PORT SRC
  REPO_RAW="${PORTFOLIO_REPO_RAW:-https://raw.githubusercontent.com/justintimefordinner-lang/Robinhood-Connection/main}"
  DIR="${PORTFOLIO_DIR:-$HOME/portfolio-robinhood}"
  SRC="${PORTFOLIO_MIGRATE_FROM:-}"

  # ── prerequisites ───────────────────────────────────────────────────────
  say "Checking Docker"

  command -v docker >/dev/null 2>&1 || die \
"Docker isn't installed.

  Raspberry Pi:     curl -fsSL https://get.docker.com | sh
                    sudo usermod -aG docker \$USER    (then log out and back in)
  Windows / Mac:    install Docker Desktop from docker.com

Then run this installer again."

  docker compose version >/dev/null 2>&1 || die \
"Docker is installed but Docker Compose v2 is missing.
On a Pi, 'curl -fsSL https://get.docker.com | sh' installs both."

  docker info >/dev/null 2>&1 || die \
"Docker is installed but not running, or your user can't reach it.

  Windows / Mac:    start Docker Desktop and wait for it to say Running.
  Raspberry Pi:     sudo usermod -aG docker \$USER, then log out and back in."

  # ── folders ─────────────────────────────────────────────────────────────
  say "Setting up $DIR"
  mkdir -p "$DIR/data" "$DIR/bridge-state/reauth_inbox" "$DIR/bridge-state/task_inbox" "$DIR/bridge-state/.tokens"
  chmod 700 "$DIR/bridge-state" "$DIR/bridge-state/.tokens" 2>/dev/null || true
  cd "$DIR"

  # ── carry an existing install over ──────────────────────────────────────
  if [ -n "$SRC" ]; then
    SRC="${SRC/#\~/$HOME}"
    [ -d "$SRC/databridge" ] || die "PORTFOLIO_MIGRATE_FROM=$SRC doesn't look like a Robinhood-Connection checkout (no databridge/ in it)."
    say "Carrying over your existing install from $SRC"

    # Two bridges sharing one Robinhood login double the request rate, and the
    # old dashboard holds the port. Refuse rather than fight it.
    local OLD_PID=""
    if command -v pm2 >/dev/null 2>&1; then
      OLD_PID="$(pm2 pid databridge 2>/dev/null | tr -d '[:space:]' || true)"
    fi
    if [ -n "$OLD_PID" ] && [ "$OLD_PID" != "0" ]; then
      die "The old bridge is still running under pm2. Stop it first:

      pm2 stop appfiles databridge databridge-history databridge-earnings
      pm2 save

Then run this again."
    fi
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet databridge.service 2>/dev/null; then
      die "The old bridge is still running under systemd. Stop it first:

      sudo systemctl disable --now databridge.service appfiles.service databridge-history.timer databridge-earnings.timer

Then run this again."
    fi

    # The saved session + login guard state. -n: never overwrite a newer one.
    if [ -d "$HOME/.tokens" ]; then
      cp -n "$HOME/.tokens/robinhood.pickle"            bridge-state/.tokens/ 2>/dev/null || true
      cp -n "$HOME/.tokens/robinhood_login_state.json"  bridge-state/.tokens/ 2>/dev/null || true
      chmod 600 bridge-state/.tokens/* 2>/dev/null || true
      [ -f bridge-state/.tokens/robinhood.pickle ] && echo "    saved Robinhood session: carried over" \
                                                   || echo "    saved Robinhood session: none found (you'll approve one login)"
    fi

    # Settings + sign-in. The data folder has a different path inside a
    # container, so that one line is rewritten; everything else is kept as is.
    if [ -f "$SRC/databridge/.env" ] && [ ! -f bridge-state/.env ]; then
      grep -v '^[[:space:]]*APP_DATA_DIR=' "$SRC/databridge/.env" > bridge-state/.env || true
      printf 'APP_DATA_DIR=/app/data\n' >> bridge-state/.env
      chmod 600 bridge-state/.env
      echo "    settings and sign-in: carried over"
    fi

    # History, closed trades, approved list, manual entries.
    if [ -d "$SRC/appfiles/data" ]; then
      cp -rn "$SRC/appfiles/data/." data/ 2>/dev/null || true
      rm -f data/README.md data/*.log 2>/dev/null || true
      echo "    data folder: carried over"
    fi
  fi

  # ── compose file ────────────────────────────────────────────────────────
  say "Downloading the compose file"
  curl -fsSL "$REPO_RAW/docker-compose.release.yml" -o docker-compose.yml \
    || die "Couldn't download the compose file. Check your internet connection."

  # ── settings ────────────────────────────────────────────────────────────
  if [ -f .env ]; then
    say "Keeping your existing .env"
  else
    say "Writing settings (.env)"
    # Fall back sensibly on machines where these aren't available.
    TZ_GUESS="$( (timedatectl show -p Timezone --value 2>/dev/null) \
              || (readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||') \
              || true )"
    [ -n "${TZ_GUESS:-}" ] || TZ_GUESS="America/Denver"

    cat > .env <<ENV
# Portfolio (Robinhood) settings. No secrets live here — your Robinhood sign-in
# is entered on the dashboard's Settings page and stored in
# bridge-state/credentials.env, which only the bridge reads.

TZ=$TZ_GUESS

# Run the containers as you, so files they write stay editable from your shell.
UID=$(id -u)
GID=$(id -g)

# Change if something else already uses port 3001. (3000 is left for the
# Schwab dashboard so the two can run side by side.)
DASHBOARD_PORT=3001

# Tracks the newest build. To pin to a specific release instead, use the
# version number WITHOUT the leading v — for example IMAGE_TAG=2.0.0
IMAGE_TAG=latest
ENV
  fi

  # ── start ───────────────────────────────────────────────────────────────
  say "Pulling images and starting (about a minute)"
  docker compose pull
  docker compose up -d

  # An existing .env may not have DASHBOARD_PORT at all; that's fine.
  PORT="$(grep -E '^DASHBOARD_PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || true)"
  PORT="${PORT:-3001}"

  cat <<DONE

  ────────────────────────────────────────────────────────────
   Running.

   Open   http://localhost:$PORT

   The dashboard fills in with example data straight away. To see
   your own account, go to Settings → Robinhood connection.

   Installed in:  $DIR
   Check on it:   cd $DIR && docker compose ps
   Read the logs: cd $DIR && docker compose logs -f
   Update later:  cd $DIR && docker compose pull && docker compose up -d
  ────────────────────────────────────────────────────────────

DONE

  if ! docker compose ps --status running --quiet | grep -q .; then
    warn "Containers aren't reporting as running yet. Give it a few seconds, then:
      cd $DIR && docker compose ps && docker compose logs"
  fi
}

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31mxx\033[0m %s\n\n' "$1" >&2; exit 1; }

main "$@"

#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
#  Small jobs before the bridge starts. Everything here is best-effort and
#  runs as whatever unprivileged user compose chose, so nothing needs root.
#
#  1. Create the inbox directories and the session folder under /state, so the
#     dashboard's markers have somewhere to land even before Settings has been
#     opened, and keep the secret files owner-only however the umask (or a copy
#     from an older install) left them.
#
#  2. Re-create the /opt/bridge -> /state symlinks if they are absent. They are
#     baked into the image, but a developer bind-mounting a working copy over
#     /opt/bridge hides them, and this puts them back. A real file at one of
#     those names is the developer's own and is left alone.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

if [ -d /state ] && [ -w /state ]; then
  mkdir -p /state/reauth_inbox /state/task_inbox /state/.tokens
  chmod 700 /state/.tokens 2>/dev/null || true
  [ -f /state/credentials.env ]          && chmod 600 /state/credentials.env          2>/dev/null || true
  [ -f /state/.env ]                     && chmod 600 /state/.env                     2>/dev/null || true
  [ -f /state/.tokens/robinhood.pickle ] && chmod 600 /state/.tokens/robinhood.pickle 2>/dev/null || true
elif [ "$(pwd)" = "/state" ]; then
  echo "[entrypoint] WARNING: /state is not writable. Mount ./bridge-state at /state" \
       "and run the container as the user that owns it (see docker-compose.release.yml)." >&2
fi

link() {
  # $1 = name under /state, also the name inside /opt/bridge
  [ -L "/opt/bridge/$1" ] && return 0
  [ -e "/opt/bridge/$1" ] && return 0
  ln -s "/state/$1" "/opt/bridge/$1" 2>/dev/null || true
}

if [ -d /opt/bridge ]; then
  link .env
  link credentials.env
  link reauth_inbox
  link task_inbox
fi

exec "$@"

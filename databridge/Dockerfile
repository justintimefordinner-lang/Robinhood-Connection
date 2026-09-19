# ─────────────────────────────────────────────────────────────────────────────
#  Robinhood bridge — release image (source baked in)
#
#  The code ships inside the image at /opt/bridge. Everything that has to
#  survive a container being replaced lives on the host, mounted at /state:
#
#      .env               refresh intervals etc., written by the dashboard's Settings page
#      credentials.env    the Robinhood sign-in, written by the dashboard, read by the bridge
#      reauth_inbox/      the dashboard drops "reconnect" requests here
#      task_inbox/        the dashboard drops history-rebuild / brief-refresh requests here
#      .tokens/           robinhood.pickle (the saved session) + login_guard's state
#
#  Two things make that work without touching the login code:
#
#    * /state is the WORKING DIRECTORY, so every relative path in the Python
#      (credentials.env, reauth_inbox/reconnect, task_inbox/…) lands on a real,
#      writable host file.
#
#    * HOME is /state. robin_stocks keeps its session in ~/.tokens/robinhood.pickle
#      and login_guard keeps its state next to it; both call expanduser("~"). With
#      HOME pointed at the mount, those are /state/.tokens/… — the saved session
#      outlives the container, so a new image does NOT mean a new phone approval.
#      Copying an existing ~/.tokens folder into bridge-state/ carries a working
#      session over from a non-Docker install.
#
#  The state names are also symlinked from /opt/bridge onto /state, for two reasons:
#    * load_dotenv() with no argument looks for .env next to the calling script
#      — in /opt/bridge, not the working directory. The symlink makes it find
#      /state/.env. python-dotenv treats a dangling symlink as "no .env", which
#      is exactly right before first-run setup.
#    * A published image layer must never contain a credential. With the names
#      pinned to symlinks, /opt/bridge can only ever hold pointers into /state.
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim-bookworm

# Links the published package to this repo on GitHub.
LABEL org.opencontainers.image.source="https://github.com/justintimefordinner-lang/Robinhood-Connection"
LABEL org.opencontainers.image.description="Read-only Robinhood market-data bridge for the Portfolio dashboard"
LABEL org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

# tzdata so the market-hours logic reads the New York clock (without it the
# bridge treats the market as always open and spends requests off-hours).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/state

# Dependencies first, so edits to the Python don't invalidate the pip layer.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm -f /tmp/requirements.txt

# The application itself. .dockerignore keeps secrets and local state out of
# the build context; the rm below is belt and braces on top of that.
COPY . /opt/bridge

# Pin the working-directory state names to symlinks onto /state.
RUN rm -rf /opt/bridge/reauth_inbox /opt/bridge/task_inbox /opt/bridge/.tokens \
 && rm -f  /opt/bridge/.env /opt/bridge/credentials.env \
 && ln -s /state/.env             /opt/bridge/.env \
 && ln -s /state/credentials.env  /opt/bridge/credentials.env \
 && ln -s /state/reauth_inbox     /opt/bridge/reauth_inbox \
 && ln -s /state/task_inbox       /opt/bridge/task_inbox

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# State is the working directory. Created here so `docker run` alone has one;
# compose bind-mounts ./bridge-state over it, and the host's ownership wins.
RUN mkdir -p /state
WORKDIR /state

# The script is given by absolute path because the working directory is not
# the code directory. Python puts the script's own folder (/opt/bridge) on
# sys.path, so `import reauth`, `import export_to_app` etc. resolve as before.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["python", "/opt/bridge/auto_push.py"]

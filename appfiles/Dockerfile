# ─────────────────────────────────────────────────────────────────────────────
#  Trading dashboard — Next.js 16 production build
#  Commit as:  Trading_Dashboard_App/Dockerfile
#
#  Unlike the bridge, the dashboard's source IS baked in: Next has to compile,
#  and compiling on every container start would cost minutes on a Pi. Updating
#  the dashboard is therefore:
#
#      git pull && docker compose up -d --build dashboard
#
#  Uses `output: "standalone"` (set in next.config.ts): the runtime stage
#  ships only server.js + traced node_modules, roughly 250 MB instead of 1.2 GB.
#  note at the bottom for the smaller-image version once you're green.
# ─────────────────────────────────────────────────────────────────────────────

# ---- deps ----------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` needs the lockfile to match package.json exactly. If this fails,
# run `npm install` locally and commit the updated package-lock.json.
RUN npm ci

# ---- build ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# data/ is gitignored and .dockerignore'd, but make sure the build never sees a
# stale snapshot: the app falls back to lib/example.ts when data/ is empty,
# which is exactly the first-run experience we want.
RUN rm -rf data && mkdir -p data \
 && npm run build

# ---- runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Link the published package to this repo on GitHub: the package page shows the
# README and the package can be managed from the repo. Must sit in the final
# stage — labels set in the deps/build stages do not survive into the image.
LABEL org.opencontainers.image.source="https://github.com/justintimefordinner-lang/Trading_Dashboard_App"
LABEL org.opencontainers.image.description="Self-hosted portfolio dashboard for the Schwab market-data bridge"
LABEL org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static     ./.next/static
COPY --from=build /app/public           ./public

# data/ and /bridge are bind-mounted by compose at runtime. Creating the
# mountpoints here keeps ownership sane when they're mounted.
# Owned by uid/gid 1000 (the image's `node` user) because compose runs the
# container as your user, and Next writes .next/cache at runtime. The two
# mountpoints take the host's ownership once mounted.
RUN mkdir -p /app/data /bridge \
 && chown -R 1000:1000 /app /bridge

EXPOSE 3000

# server.js binds to $HOSTNAME/$PORT (set above), so it is reachable from your LAN and Tailscale.
CMD ["node", "server.js"]

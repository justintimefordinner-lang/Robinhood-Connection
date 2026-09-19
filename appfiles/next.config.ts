import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The Docker image runs the self-contained server this emits (see Dockerfile).
  output: "standalone",
  // Pin the Turbopack project root to this folder explicitly. Without this,
  // Turbopack infers the root from the nearest lockfile it finds — and if a
  // stray package-lock.json exists one level up (alongside the sibling
  // `databridge` project), it can pick THAT as the root instead of appfiles/.
  // With the root set that high, the build scan expands to include databridge/
  // too, and walks into databridge/.venv/bin/python — a symlink a Python venv
  // creates pointing at the system Python binary — which Turbopack's sandboxed
  // file walker refuses to follow, crashing the whole build. Only matters when
  // building from a checkout; the image build only ever sees appfiles/.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // DEV-SERVER ONLY: origins allowed to load the dev runtime (HMR/RSC/assets).
  // Has no effect on the production server (`next start`), which serves any origin.
  // Add the addresses you use to reach the dev server from other devices (e.g.
  // your phone). Examples:
  //   "192.168.1.x",             // your machine's LAN IP
  //   "my-pc.tailXXXX.ts.net",   // a specific Tailscale MagicDNS host
  allowedDevOrigins: [
    "*.ts.net", // any Tailscale MagicDNS hostname
  ],
};

export default nextConfig;

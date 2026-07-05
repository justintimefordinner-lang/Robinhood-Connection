import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the Turbopack project root to this folder explicitly. Without this,
  // Turbopack infers the root from the nearest lockfile it finds — and if a
  // stray package-lock.json exists at ~/JerStock (one level up, alongside
  // the sibling `databridge` project), it can pick THAT as the root instead
  // of appfiles/. With the root set that high, the build scan expands to
  // include databridge/ too, and walks into databridge/.venv/bin/python — a
  // symlink a Python venv creates pointing at the system Python binary —
  // which Turbopack's sandboxed file walker refuses to follow (it looks like
  // it "points out of the filesystem root" from Turbopack's perspective),
  // crashing the whole build. Pinning the root here means that mis-detection
  // can't happen regardless of what other lockfiles exist nearby.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // DEV-SERVER ONLY: origins allowed to load the dev runtime (HMR/RSC/assets).
  // Has no effect on the production server (`next start`), which serves any origin.
  // Includes the home Wi-Fi IPs plus Tailscale. If reaching the phone by a raw
  // 100.x.y.z Tailscale IP rather than the MagicDNS name, add that exact IP here.
  allowedDevOrigins: [
    "192.168.0.50",
    "172.20.176.1",
    "*.ts.net", // Tailscale MagicDNS hostnames (e.g. my-pc.tailXXXX.ts.net)
  ],
};

export default nextConfig;

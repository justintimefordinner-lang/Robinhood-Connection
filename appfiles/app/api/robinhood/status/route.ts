// One-way status read: returns the sanitized robinhood-auth.json the bridge
// writes into this app's own data/ folder. Contains no secrets — whether a
// sign-in is on file, whether a session exists, the login guard's state, and
// the last error.
import { readAuthStatus } from "@/lib/bridge-files";
import { bridgeById } from "@/lib/bridges";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bridge = bridgeById(new URL(req.url).searchParams.get("bridge"));
  if (!bridge) return Response.json({ error: "unknown bridge" }, { status: 404 });
  return Response.json(readAuthStatus(bridge));
}

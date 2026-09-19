// One-way status read for a given bridge (?bridge=<id>, default primary): returns
// the sanitized schwab-auth.json the bridge writes into this app's own data/ folder.
// Contains no secrets — just whether setup is done, whether a token exists, the
// current auth-flow state, and (only while a login is pending) the Schwab login URL.
import { readAuthStatus } from "@/lib/bridge-files";
import { bridgeById } from "@/lib/bridges";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bridge = bridgeById(new URL(req.url).searchParams.get("bridge"));
  if (!bridge) return Response.json({ error: "unknown bridge" }, { status: 404 });
  return Response.json(readAuthStatus(bridge));
}

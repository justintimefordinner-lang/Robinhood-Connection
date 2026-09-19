// Ask the bridge for ONE fresh Robinhood login attempt. Write-only: drops an
// empty marker into the bridge's reauth_inbox/. The bridge (auto_push loop) sees
// it, bypasses its failed-login lock for that single attempt, and publishes the
// outcome through the app's own data/ folder (read via /api/robinhood/status).
// Without a saved authenticator key Robinhood sends an approval prompt to the
// phone, and the attempt waits about two minutes for it.
import { demoBlocked } from "@/lib/demo";
import { requestReconnect } from "@/lib/bridge-files";
import { bridgeById } from "@/lib/bridges";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = demoBlocked();
  if (blocked) return blocked;
  let id: string | null = null;
  try {
    id = ((await req.json()) as { bridge?: string })?.bridge ?? null;
  } catch {
    id = null; // no body → primary bridge
  }
  const bridge = bridgeById(id);
  if (!bridge) return Response.json({ ok: false, error: "unknown bridge" }, { status: 404 });
  try {
    requestReconnect(bridge);
  } catch {
    return Response.json({ ok: false, error: "Could not request a reconnect." }, { status: 500 });
  }
  return Response.json({ ok: true });
}

// Ask a bridge to generate a fresh Schwab login URL. Write-only: drops an empty
// marker into that bridge's reauth_inbox/. The bridge (auto_push loop) sees it,
// generates the URL, and publishes it back through the app's own data/ folder
// (read via /api/schwab/status?bridge=<id>). The app never touches the App Key here.
import { demoBlocked } from "@/lib/demo";
import { requestReauthStart } from "@/lib/bridge-files";
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
    requestReauthStart(bridge);
  } catch {
    return Response.json({ ok: false, error: "Could not start re-authentication." }, { status: 500 });
  }
  return Response.json({ ok: true });
}

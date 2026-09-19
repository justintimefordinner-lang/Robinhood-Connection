// Deposit the pasted post-login redirect URL for a bridge to exchange for a token.
// Write-only: the URL (which carries a one-time auth code) is written to that
// bridge's reauth_inbox/redirect_url and consumed by the bridge. Never logged.
import { demoBlocked } from "@/lib/demo";
import { submitRedirectUrl } from "@/lib/bridge-files";
import { bridgeById } from "@/lib/bridges";

export const dynamic = "force-dynamic";

interface SubmitBody {
  bridge?: string;
  url?: string;
}

export async function POST(req: Request) {
  const blocked = demoBlocked();
  if (blocked) return blocked;
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const bridge = bridgeById(body.bridge);
  if (!bridge) return Response.json({ ok: false, error: "unknown bridge" }, { status: 404 });

  const url = (body.url || "").trim();
  if (!url || !url.includes("code=")) {
    return Response.json(
      { ok: false, error: "Paste the full redirect URL — it should contain ?code=..." },
      { status: 400 },
    );
  }

  try {
    submitRedirectUrl(bridge, url);
  } catch {
    return Response.json({ ok: false, error: "Could not submit the redirect URL." }, { status: 500 });
  }

  return Response.json({ ok: true });
}

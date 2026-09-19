// Deposit the Robinhood sign-in into the bridge's credentials.env (WHOLESALE
// write — never read back). type=password field on the client; nothing is
// logged or echoed. This is the app's only write of the password, and it never
// reads it again.
import { demoBlocked } from "@/lib/demo";
import { writeCredentials } from "@/lib/bridge-files";
import { bridgeById } from "@/lib/bridges";

export const dynamic = "force-dynamic";

interface SetupBody {
  bridge?: string;
  username?: string;
  password?: string;
  totpSecret?: string;
}

export async function POST(req: Request) {
  const blocked = demoBlocked();
  if (blocked) return blocked;
  let body: SetupBody;
  try {
    body = (await req.json()) as SetupBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const bridge = bridgeById(body.bridge);
  if (!bridge) return Response.json({ ok: false, error: "unknown bridge" }, { status: 404 });

  const username = (body.username || "").trim();
  const password = body.password || "";
  const totpSecret = (body.totpSecret || "").trim();

  if (!username || !password) {
    return Response.json({ ok: false, error: "Username and password are both required." }, { status: 400 });
  }
  // The authenticator KEY is the long base32 setup key, not a 6-digit code.
  if (totpSecret && !/^[A-Za-z2-7\s=]{16,}$/.test(totpSecret)) {
    return Response.json(
      { ok: false, error: "That isn't an authenticator setup key. Use the long letters-and-digits key, not the 6-digit code." },
      { status: 400 },
    );
  }

  try {
    writeCredentials(bridge, username, password, totpSecret || undefined);
  } catch {
    // Deliberately generic — never surface a filesystem path that could leak
    // where secrets live.
    return Response.json({ ok: false, error: "Could not save credentials." }, { status: 500 });
  }

  return Response.json({ ok: true });
}

// Backs the Settings page's Robinhood login form. Writes straight to
// databridge/.env via the same writeEnvUpdates() helper /api/settings uses —
// same file, same gitignored location, same 0600 permissions. Nothing here
// ever gets stored anywhere else (no database, no logs of the password).
import { BRIDGE_ENV_PATH } from "@/lib/bridge-dir";
import { readEnvFile, writeEnvUpdates } from "@/lib/env-file";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = readEnvFile(BRIDGE_ENV_PATH);
  return Response.json({
    configured: !!(env.ROBINHOOD_USERNAME && env.ROBINHOOD_PASSWORD),
    // Username isn't sensitive on its own (it's usually just an email) and
    // showing it back lets the form confirm which account is saved without
    // ever touching the password. Password is write-only — never returned.
    username: env.ROBINHOOD_USERNAME || "",
  });
}

interface CredentialsBody {
  username?: string;
  password?: string;
}

export async function POST(req: Request) {
  let body: CredentialsBody;
  try {
    body = (await req.json()) as CredentialsBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const username = (body.username || "").trim();
  const password = body.password || "";

  if (!username || !password) {
    return Response.json({ ok: false, error: "Username and password are both required." }, { status: 400 });
  }

  writeEnvUpdates(BRIDGE_ENV_PATH, {
    ROBINHOOD_USERNAME: username,
    ROBINHOOD_PASSWORD: password,
  });

  return Response.json({ ok: true });
}

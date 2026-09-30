// Is a newer build published? Cached five hours; ?force=1 asks GitHub again.
import { DEMO_MODE } from "@/lib/demo";
import { checkForUpdate } from "@/lib/update";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (DEMO_MODE) return Response.json({ enabled: false, available: false });
  const force = new URL(req.url).searchParams.get("force") === "1";
  return Response.json(await checkForUpdate(force));
}

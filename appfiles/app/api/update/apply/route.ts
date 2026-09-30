// Ask the updater container to pull the newest images and recreate the stack.
// Write-only: this only drops a marker in the app's own data/ folder.
import { demoBlocked } from "@/lib/demo";
import { BUILD_SHA, requestUpdate } from "@/lib/update";

export const dynamic = "force-dynamic";

export async function POST() {
  const blocked = demoBlocked();
  if (blocked) return blocked;
  if (!BUILD_SHA) return Response.json({ ok: false, error: "This build isn't from a published image, so there's nothing to update to." });
  try {
    requestUpdate();
  } catch {
    return Response.json({ ok: false, error: "Could not request the update." }, { status: 500 });
  }
  return Response.json({ ok: true });
}

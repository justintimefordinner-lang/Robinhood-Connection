// Read-only demo deployment.
//
// Set NEXT_PUBLIC_DEMO_MODE=1 to pin a public build (Vercel and the like) into the
// bundled example dataset. Two things follow from it:
//
//   * isExampleMode() is always true, so every loader serves lib/example.ts and no
//     screen can land on an empty state — a demo host has no data/ files at all.
//   * Every write endpoint short-circuits. Those routes deposit into the bridge
//     folder or the app's own data/ dir; on a serverless host the filesystem is
//     read-only, so without this they'd throw where a visitor expects a save.
//
// NEXT_PUBLIC_ so the client bundle can read it too — the Example toggle hides
// itself in a demo, since there's nothing to toggle back to.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/**
 * Guard for write route handlers. Returns a response to send when this build is a
 * demo, or null to carry on normally:
 *
 *     const blocked = demoBlocked();
 *     if (blocked) return blocked;
 *
 * Answers 200 with `ok: false` rather than an error status, so the existing UI
 * surfaces the message inline instead of rendering a failure.
 */
/**
 * Client-side check for whether the app is currently showing the bundled example
 * dataset — either because this build is a pinned demo, or because the viewer has
 * turned Example mode on. Lets client components pick defaults that suit demo data
 * (see components/margin-mode.tsx). Returns false during SSR, where there's no
 * document to read; callers should apply it from an effect.
 */
export function isExampleClient(): boolean {
  if (DEMO_MODE) return true;
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === "exampleMode=1");
}

export function demoBlocked(): Response | null {
  if (!DEMO_MODE) return null;
  return Response.json({
    ok: false,
    error: "This is a read-only demo — changes aren't saved.",
  });
}

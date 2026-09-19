// Server-side read of the "Example mode" toggle. The Example button sets a
// cookie client-side and calls router.refresh(); server components read it here
// and swap in the example dataset (lib/example.ts) so the whole app — server and
// client rendered — shows demo values consistently.
import { cookies } from "next/headers";
import { DEMO_MODE } from "./demo";

export const EXAMPLE_COOKIE = "exampleMode";

export async function isExampleMode(): Promise<boolean> {
  // A demo deployment is pinned to the example dataset — there's no real data on
  // the host to switch back to, so the cookie never gets a say.
  if (DEMO_MODE) return true;
  try {
    return (await cookies()).get(EXAMPLE_COOKIE)?.value === "1";
  } catch {
    return false;
  }
}

// Approved-list editor endpoint. GET returns the current list; POST mutates it
// ({ action: "add" | "remove" | "set", symbol?, symbols? }) and returns the new
// list. Writes data/approved-stocks.json, which the app and Python both read.
import { demoBlocked } from "@/lib/demo";
import { getApproved, addManyApproved, removeApproved, saveApproved } from "@/lib/approved";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ symbols: getApproved() });
}

export async function POST(req: Request) {
  const blocked = demoBlocked();
  if (blocked) return blocked;
  let body: { action?: string; symbol?: string; symbols?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  let symbols: string[];
  switch (body.action) {
    case "add": {
      // Accepts a single { symbol } or a bulk { symbols: [...] } (comma-add).
      const toAdd = Array.isArray(body.symbols) ? body.symbols : body.symbol != null ? [body.symbol] : [];
      symbols = addManyApproved(toAdd);
      break;
    }
    case "remove":
      symbols = removeApproved(body.symbol ?? "");
      break;
    case "set":
      symbols = saveApproved(Array.isArray(body.symbols) ? body.symbols : []);
      break;
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
  return Response.json({ symbols });
}

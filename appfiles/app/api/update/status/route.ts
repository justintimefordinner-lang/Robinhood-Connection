import { readUpdateStatus } from "@/lib/update";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(readUpdateStatus());
}

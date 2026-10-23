import { connection } from "next/server";

import { qlooSource } from "@/lib/qloo/factory";
import { storeMode } from "@/lib/server/redis";

// `connection()` opts out of build-time prerendering: the badge must describe what this server will do for the
// next request, not what the environment looked like when the app was built.
export async function GET() {
  await connection();
  return Response.json({ source: qlooSource(), store: storeMode() }, { headers: { "cache-control": "no-store" } });
}

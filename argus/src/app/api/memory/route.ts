import { NextResponse } from "next/server";
import { runConsolidation, latestMemoryAudit } from "@/engine/memory";

// POST /api/memory — run the consolidation loop now (also runs before each
// reflection, and on its own nightly cron).
export async function POST() {
  return NextResponse.json(await runConsolidation());
}

// GET /api/memory — the latest memory-health snapshot.
export async function GET() {
  return NextResponse.json({ latest: latestMemoryAudit() ?? null });
}

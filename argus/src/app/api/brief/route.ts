import { NextResponse } from "next/server";
import { syncAll } from "@/connectors";
import { runTriage } from "@/engine/triage";
import { db, schema } from "@/db";
import { eq, desc } from "drizzle-orm";

// Overlapping runs (cron firing while the button is tapped) would triage
// every item twice and race the sync's unique-id checks. Coalesce instead:
// concurrent requests await the run already in flight and share its result.
let inFlight: Promise<{ synced: unknown; triage: unknown }> | null = null;

// POST /api/brief — the "morning brief" run: sync sources, triage new items.
export async function POST() {
  if (!inFlight) {
    inFlight = (async () => {
      const synced = await syncAll();
      const triage = await runTriage();
      return { synced, triage };
    })().finally(() => {
      inFlight = null;
    });
  }
  return NextResponse.json(await inFlight);
}

// GET /api/brief — current state for the dashboard.
export async function GET() {
  const rows = db
    .select({
      decision: schema.decisions,
      item: schema.items,
    })
    .from(schema.decisions)
    .innerJoin(schema.items, eq(schema.decisions.itemId, schema.items.id))
    .orderBy(desc(schema.decisions.createdAt))
    .all();
  return NextResponse.json({ rows });
}

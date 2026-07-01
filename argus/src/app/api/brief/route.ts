import { NextResponse } from "next/server";
import { syncAll } from "@/connectors";
import { runTriage } from "@/engine/triage";
import { db, schema } from "@/db";
import { eq, desc } from "drizzle-orm";

// POST /api/brief — the "morning brief" run: sync sources, triage new items.
export async function POST() {
  const synced = await syncAll();
  const triage = await runTriage();
  return NextResponse.json({ synced, triage });
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

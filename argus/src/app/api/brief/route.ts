import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc, eq, gte, isNull, or } from "drizzle-orm";
import { runBrief } from "@/engine/brief";

// POST /api/brief — run the brief now (the button; cron uses runBrief directly).
export async function POST() {
  const result = await runBrief("manual");
  return NextResponse.json(result);
}

// GET /api/brief — today's board: decisions created today plus anything
// older still awaiting a response (carryover). History stays in the DB;
// the daily view stays clearable — "all caught up" is reachable every day.
export async function GET() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows = db
    .select({
      decision: schema.decisions,
      item: schema.items,
      action: schema.actions,
    })
    .from(schema.decisions)
    .innerJoin(schema.items, eq(schema.decisions.itemId, schema.items.id))
    .leftJoin(schema.actions, eq(schema.actions.decisionId, schema.decisions.id))
    .where(
      or(
        gte(schema.decisions.createdAt, startOfToday),
        isNull(schema.decisions.userResponse),
      ),
    )
    .orderBy(desc(schema.decisions.createdAt))
    .all()
    .map(({ decision, item, action }) => ({
      decision,
      item,
      executed: !!action && !action.reversedAt,
      reversed: !!action?.reversedAt,
      carryover: decision.createdAt < startOfToday,
    }));

  const lastBrief = db
    .select()
    .from(schema.briefs)
    .orderBy(desc(schema.briefs.id))
    .limit(1)
    .get();

  return NextResponse.json({ rows, lastBrief: lastBrief ?? null });
}

import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc, eq, isNotNull } from "drizzle-orm";

// GET /api/history — the record: recent brief runs, all-time totals, and the
// most recent responded decisions (the audit trail behind the daily board).
export async function GET() {
  const briefs = db
    .select()
    .from(schema.briefs)
    .orderBy(desc(schema.briefs.id))
    .limit(30)
    .all();

  const responded = db
    .select({ decision: schema.decisions, item: schema.items })
    .from(schema.decisions)
    .innerJoin(schema.items, eq(schema.decisions.itemId, schema.items.id))
    .where(isNotNull(schema.decisions.userResponse))
    .orderBy(desc(schema.decisions.respondedAt))
    .limit(50)
    .all();

  const all = db
    .select({
      userResponse: schema.decisions.userResponse,
      autoRuleId: schema.decisions.autoRuleId,
    })
    .from(schema.decisions)
    .all();

  const totals = {
    decisions: all.length,
    approved: all.filter((d) => d.userResponse === "approved" && !d.autoRuleId).length,
    auto: all.filter((d) => !!d.autoRuleId).length,
    rejected: all.filter((d) => d.userResponse === "rejected").length,
    acknowledged: all.filter((d) => d.userResponse === "acknowledged").length,
  };

  return NextResponse.json({ briefs, responded, totals });
}

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { undo } from "@/engine/executor";
import { captureGolden } from "@/engine/evals";
import { scoreOnResponse, demoteRule } from "@/engine/experiments";

// POST /api/decisions/:id/undo — take back an executed reversible action.
// An undo is the strongest "that was wrong" signal there is: it flips the
// decision to rejected, banks a negative golden case, and counts as a
// disagreement against the rule (if any) that auto-executed it — which can
// demote the rule.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decision = db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, Number(id)))
    .get();
  if (!decision) {
    return NextResponse.json({ error: "decision not found" }, { status: 404 });
  }
  if (decision.userResponse !== "approved") {
    return NextResponse.json(
      { error: "only executed (approved) decisions can be undone" },
      { status: 409 },
    );
  }

  // Claim first, mirroring the approve path: flip to rejected synchronously
  // (same event-loop tick as the check above) so a concurrent duplicate
  // request — e.g. a double-clicked Undo button — 409s instead of running the
  // whole undo path twice and double-feeding the learning loops. Rolled back
  // if the actual reversal fails.
  db.update(schema.decisions)
    .set({ userResponse: "rejected", respondedAt: new Date() })
    .where(eq(schema.decisions.id, decision.id))
    .run();

  let reversed: string;
  try {
    reversed = await undo(decision.id);
  } catch (err) {
    db.update(schema.decisions)
      .set({ userResponse: "approved", respondedAt: decision.respondedAt })
      .where(eq(schema.decisions.id, decision.id))
      .run();
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 409 });
  }

  const item = db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, decision.itemId))
    .get();
  if (item) {
    captureGolden(item, decision, "rejected");
    scoreOnResponse(item, decision, "rejected"); // records the disagreement
    // If this action was auto-executed, the undo demotes that rule outright —
    // the lifetime rate above is too slow to withdraw autonomy on its own.
    if (decision.autoRuleId) demoteRule(decision.autoRuleId);
    const now = new Date();
    db.insert(schema.preferences)
      .values({
        // An explicit undo is the strongest signal there is → high trust.
        note: `User UNDID "${decision.action}"${decision.autoRuleId ? " (auto-executed)" : ""} on "${item.title.slice(0, 60)}" — do not repeat this.`,
        learnedFrom: `decision:${decision.id}`,
        trust: "user",
        reinforcedAt: now,
        createdAt: now,
      })
      .run();
  }

  return NextResponse.json({ ok: true, reversed });
}

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { execute } from "@/engine/executor";
import { captureGolden } from "@/engine/evals";
import { scoreOnResponse, maybeCreateFromHistory } from "@/engine/experiments";

// POST /api/decisions/:id  { response: "approved" | "rejected" | "acknowledged", note?: string }
//
// Every decision takes a disposition — including informational "needs you"
// items, which are acknowledged rather than approved. An optional note on
// any response feeds the preference flywheel.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Tolerate an empty/malformed body (e.g. a curl without -d): fall through to
  // the validation below with a clean 400 rather than an unhandled 500.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const response = body.response as string;
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!["approved", "rejected", "acknowledged"].includes(response)) {
    return NextResponse.json(
      { error: "response must be approved|rejected|acknowledged" },
      { status: 400 },
    );
  }

  const decision = db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, Number(id)))
    .get();
  if (!decision) {
    return NextResponse.json({ error: "decision not found" }, { status: 404 });
  }

  // A decision takes exactly one response, ever. Re-submissions are rejected
  // so an action can never run twice and the audit trail can't be rewritten
  // after execution. (This check + the claim below run synchronously in one
  // event-loop tick, so concurrent requests can't both pass.)
  if (decision.userResponse) {
    return NextResponse.json(
      { error: `decision already ${decision.userResponse}` },
      { status: 409 },
    );
  }

  let executed: string | null = null;
  if (response === "approved" && decision.action !== "none") {
    // Claim first (so a concurrent request 409s), then execute. If execution
    // fails, release the claim: the decision returns to pending — audit stays
    // truthful (no action row, not marked done) and the user can retry.
    db.update(schema.decisions)
      .set({ userResponse: "approved", respondedAt: new Date() })
      .where(eq(schema.decisions.id, decision.id))
      .run();
    try {
      executed = await execute(decision.id);
    } catch (err) {
      db.update(schema.decisions)
        .set({ userResponse: null, respondedAt: null })
        .where(eq(schema.decisions.id, decision.id))
        .run();
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `execution failed: ${message}` },
        { status: 502 },
      );
    }
  } else {
    db.update(schema.decisions)
      .set({ userResponse: response, respondedAt: new Date() })
      .where(eq(schema.decisions.id, decision.id))
      .run();
  }

  // Feed the learning loops. Every manual response is signal: it becomes a
  // golden-set case (loop 3), scores any matching shadow experiments
  // (loop 1), and — on approvals — may reveal a pattern worth shadowing.
  const item = db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, decision.itemId))
    .get();
  if (item) {
    captureGolden(item, decision, response);
    scoreOnResponse(item, decision, response);
    if (response === "approved") maybeCreateFromHistory(item, decision);
  }

  // Rejections always teach; an explicit note teaches more. Acknowledgements
  // only teach when the user bothered to say why.
  if (response === "rejected" || note) {
    const now = new Date();
    db.insert(schema.preferences)
      .values({
        note: note
          ? `User said: "${note}" (re: ${decision.verdict}/${decision.action} — ${decision.reason})`
          : `User rejected "${decision.action}" (${decision.reason})`,
        learnedFrom: `decision:${decision.id}`,
        // A note the user typed is high-trust ('user'); an auto-summarized
        // rejection is 'inferred' and will decay if it isn't reinforced.
        trust: note ? "user" : "inferred",
        reinforcedAt: now,
        createdAt: now,
      })
      .run();
  }

  return NextResponse.json({ ok: true, executed });
}

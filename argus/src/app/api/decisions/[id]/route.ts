import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { execute } from "@/engine/executor";

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
  const body = await req.json();
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

  db.update(schema.decisions)
    .set({ userResponse: response, respondedAt: new Date() })
    .where(eq(schema.decisions.id, Number(id)))
    .run();

  let executed: string | null = null;
  if (response === "approved" && decision.action !== "none") {
    executed = await execute(Number(id));
  }

  // Rejections always teach; an explicit note teaches more. Acknowledgements
  // only teach when the user bothered to say why.
  if (response === "rejected" || note) {
    db.insert(schema.preferences)
      .values({
        note: note
          ? `User said: "${note}" (re: ${decision.verdict}/${decision.action} — ${decision.reason})`
          : `User rejected "${decision.action}" (${decision.reason})`,
        learnedFrom: `decision:${decision.id}`,
        createdAt: new Date(),
      })
      .run();
  }

  return NextResponse.json({ ok: true, executed });
}

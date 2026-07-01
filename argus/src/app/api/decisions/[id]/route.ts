import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { execute } from "@/engine/executor";

// POST /api/decisions/:id  { response: "approved" | "rejected" }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const response = body.response as string;
  if (response !== "approved" && response !== "rejected") {
    return NextResponse.json({ error: "response must be approved|rejected" }, { status: 400 });
  }

  db.update(schema.decisions)
    .set({ userResponse: response, respondedAt: new Date() })
    .where(eq(schema.decisions.id, Number(id)))
    .run();

  let executed: string | null = null;
  if (response === "approved") {
    executed = await execute(Number(id));
  } else {
    // Rejections feed the preference flywheel (summarized properly in Phase 2).
    const d = db.select().from(schema.decisions).where(eq(schema.decisions.id, Number(id))).get();
    if (d) {
      db.insert(schema.preferences)
        .values({
          note: `User rejected "${d.action}" (${d.reason})`,
          learnedFrom: `decision:${d.id}`,
          createdAt: new Date(),
        })
        .run();
    }
  }
  return NextResponse.json({ ok: true, executed });
}

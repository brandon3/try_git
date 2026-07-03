import { NextRequest, NextResponse } from "next/server";
import { respondHorizon } from "@/engine/horizons";

// POST /api/horizons/:id  { verdict: "saved" | "dismissed" | "snoozed" }
// Save trains taste toward this; dismiss trains away. Both feed the next scan.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const verdict = body.verdict as string;
  if (!["saved", "dismissed", "snoozed"].includes(verdict)) {
    return NextResponse.json(
      { error: "verdict must be saved|dismissed|snoozed" },
      { status: 400 },
    );
  }
  const ok = respondHorizon(Number(id), verdict as "saved" | "dismissed" | "snoozed");
  if (!ok) {
    return NextResponse.json(
      { error: "horizon not found or already answered" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}

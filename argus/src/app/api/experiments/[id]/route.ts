import { NextRequest, NextResponse } from "next/server";
import { resolveProposal } from "@/engine/experiments";

// POST /api/experiments/:id  { verdict: "promote" | "retire" }
// The user's ruling on a proposed automation. Promotion is the ONLY path
// by which an experiment becomes a live rule.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const verdict = body.verdict as string;
  if (verdict !== "promote" && verdict !== "retire") {
    return NextResponse.json(
      { error: "verdict must be promote|retire" },
      { status: 400 },
    );
  }
  const result = resolveProposal(Number(id), verdict);
  if (!result) {
    return NextResponse.json(
      { error: "experiment not found or not in proposed state" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, status: result.status });
}

import { NextResponse } from "next/server";
import { runReflection } from "@/engine/reflect";

// POST /api/reflect — the nightly reflection: distill responses into a new
// constitution version, gated by the golden-set evals. At home this runs from
// cron after the morning brief; the dashboard also exposes a button. The run
// is coalesced (see runReflection), so overlapping calls share one pass.
export async function POST() {
  return NextResponse.json(await runReflection());
}

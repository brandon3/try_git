import { NextResponse } from "next/server";
import { runReflection } from "@/engine/reflect";

// POST /api/reflect — the nightly reflection: distill responses into a new
// constitution version, gated by the golden-set evals. At home this runs
// from cron after the morning brief; the dashboard also exposes a button.
let inFlight: Promise<unknown> | null = null;

export async function POST() {
  if (!inFlight) {
    inFlight = runReflection().finally(() => {
      inFlight = null;
    });
  }
  return NextResponse.json(await inFlight);
}

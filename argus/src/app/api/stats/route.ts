import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc, eq } from "drizzle-orm";
import { experimentSummary } from "@/engine/experiments";
import { computeCalibration } from "@/engine/calibration";
import { responseCount } from "@/engine/triage";
import { googleConfigured, googleConnected } from "@/connectors/google";

// GET /api/stats — the self-improvement dashboard: live rules, pending
// proposals, calibration, constitution version, golden-set size.
export async function GET() {
  const active = db
    .select()
    .from(schema.constitution)
    .where(eq(schema.constitution.status, "active"))
    .orderBy(desc(schema.constitution.id))
    .get();
  const goldenCount = db.select({ id: schema.goldenCases.id }).from(schema.goldenCases).all().length;

  return NextResponse.json({
    experiments: experimentSummary(),
    calibration: computeCalibration(),
    constitution: active
      ? {
          version: active.id,
          rationale: active.rationale,
          evalScore: active.evalScore,
          createdAt: active.createdAt,
          content: active.content,
        }
      : null,
    goldenCases: goldenCount,
    responses: responseCount(),
    // Health signals for the dashboard banners: is the real model wired up,
    // and are the real connectors actually connected?
    engineMode: process.env.ANTHROPIC_API_KEY ? "claude" : "mock",
    google: { configured: googleConfigured(), connected: googleConnected() },
  });
}

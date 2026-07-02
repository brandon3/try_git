import { db, schema } from "@/db";
import { and, isNotNull, isNull, ne } from "drizzle-orm";

// Loop 4 — calibration: measure how often the model's stated confidence is
// actually right, using the user's taps as ground truth. Empirical accuracy
// (not self-reported confidence) is what future autonomy gates should trust,
// and feeding the measurement back into the prompt corrects the model.

export type CalibrationBucket = { n: number; accuracy: number };
export type Calibration = Record<"high" | "medium" | "low", CalibrationBucket>;

export function computeCalibration(): Calibration {
  // Manual responses only: auto-approvals would let promoted rules grade
  // their own homework.
  const responded = db
    .select({
      confidence: schema.decisions.confidence,
      userResponse: schema.decisions.userResponse,
    })
    .from(schema.decisions)
    .where(
      and(
        isNotNull(schema.decisions.userResponse),
        ne(schema.decisions.userResponse, "acknowledged"),
        isNull(schema.decisions.autoRuleId),
      ),
    )
    .all();

  const calibration: Calibration = {
    high: { n: 0, accuracy: 0 },
    medium: { n: 0, accuracy: 0 },
    low: { n: 0, accuracy: 0 },
  };
  const correct = { high: 0, medium: 0, low: 0 };

  for (const d of responded) {
    const bucket = d.confidence as keyof Calibration;
    if (!(bucket in calibration)) continue;
    calibration[bucket].n++;
    if (d.userResponse === "approved") correct[bucket]++;
  }
  for (const key of ["high", "medium", "low"] as const) {
    const { n } = calibration[key];
    calibration[key].accuracy = n > 0 ? Math.round((correct[key] / n) * 100) : 0;
  }
  return calibration;
}

// Rendered into the triage context once there's enough signal to be worth
// steering on. Small n would just add noise.
export function calibrationNote(c: Calibration): string | null {
  const parts = (["high", "medium", "low"] as const)
    .filter((k) => c[k].n >= 5)
    .map((k) => `"${k}" confidence has been right ${c[k].accuracy}% of the time (n=${c[k].n})`);
  if (parts.length === 0) return null;
  return `Calibration from this user's history: ${parts.join("; ")}. Adjust your stated confidence to match reality.`;
}

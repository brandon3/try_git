import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { syncAll } from "@/connectors";
import { runTriage } from "./triage";
import { singleFlight } from "@/lib/util";

// One entry point for a brief run, shared by the API route and the cron
// scheduler. Every run — including failures — is recorded in `briefs`, so
// the dashboard can say "last brief 7:00 ✓" or surface a failed cron run
// instead of letting it die silently in a log file.

export type BriefResult = {
  briefId: number;
  synced: number;
  triaged: number;
  auto: number;
  engine: string;
};

// Overlapping runs (cron firing while the button is tapped) coalesce into the
// run already in flight; the first caller's trigger wins.
export const runBrief = singleFlight(execute);

async function execute(trigger: "manual" | "schedule"): Promise<BriefResult> {
  const brief = db
    .insert(schema.briefs)
    .values({ trigger, ranAt: new Date() })
    .returning()
    .get();

  try {
    const synced = await syncAll();
    const syncedCount = Object.values(synced).reduce((n, s) => n + s.inserted, 0);
    const triage = await runTriage(brief.id);

    db.update(schema.briefs)
      .set({
        status: "ok",
        synced: syncedCount,
        triaged: triage.triaged,
        auto: triage.auto,
        engine: triage.engine,
        finishedAt: new Date(),
      })
      .where(eq(schema.briefs.id, brief.id))
      .run();

    return { briefId: brief.id, synced: syncedCount, ...triage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.briefs)
      .set({ status: "error", error: message, finishedAt: new Date() })
      .where(eq(schema.briefs.id, brief.id))
      .run();
    throw err;
  }
}

import cron from "node-cron";
import { runBrief } from "@/engine/brief";
import { runReflection } from "@/engine/reflect";
import { scanHorizons } from "@/engine/horizons";
import { runConsolidation } from "@/engine/memory";

// The 7am. Started once from instrumentation.ts when the server boots.
//
// Config (env):
//   ARGUS_CRON=0            disable scheduling entirely (dev/sandbox)
//   ARGUS_BRIEF_CRON        default "0 7 * * *"
//   ARGUS_REFLECT_CRON      default "30 3 * * *"
//   ARGUS_HORIZON_CRON      default "0 18 * * 0" (Sunday evening)
//   ARGUS_MEMORY_CRON       default "0 3 * * *" (nightly, before reflection)
//   ARGUS_TZ                IANA timezone; defaults to the system timezone.
//                           Set it explicitly under systemd, where the unit
//                           may not inherit your login shell's TZ.

declare global {
  // Survives Next.js dev-mode module reloads so we never double-schedule.
  var __argusSchedulerStarted: boolean | undefined;
}

export function startScheduler(): void {
  if (process.env.ARGUS_CRON === "0") {
    console.log("[argus] scheduler disabled (ARGUS_CRON=0)");
    return;
  }
  if (globalThis.__argusSchedulerStarted) return;
  globalThis.__argusSchedulerStarted = true;

  const tz = process.env.ARGUS_TZ; // undefined → node-cron uses system TZ

  // Register one job: run it on schedule, log its outcome, never let a failure
  // escape (it's already recorded where the dashboard can surface it).
  const job = (
    label: string,
    expr: string,
    run: () => Promise<string>,
  ): void => {
    cron.schedule(
      expr,
      async () => {
        try {
          console.log(`[argus] ${label}: ${await run()}`);
        } catch (err) {
          console.error(`[argus] ${label} failed:`, err);
        }
      },
      tz ? { timezone: tz } : undefined,
    );
  };

  const briefExpr = process.env.ARGUS_BRIEF_CRON ?? "0 7 * * *";
  const memoryExpr = process.env.ARGUS_MEMORY_CRON ?? "0 3 * * *";
  const reflectExpr = process.env.ARGUS_REFLECT_CRON ?? "30 3 * * *";
  const horizonExpr = process.env.ARGUS_HORIZON_CRON ?? "0 18 * * 0";

  job("scheduled brief", briefExpr, async () => {
    const r = await runBrief("schedule");
    return `${r.triaged} triaged, ${r.auto} auto (${r.engine})`;
  });
  job("memory consolidation", memoryExpr, async () => {
    const r = await runConsolidation();
    return `health ${r.health}% — ${r.merged} merged, ${r.decayed} decayed, ${r.quarantined} quarantined`;
  });
  job("reflection", reflectExpr, async () => {
    const r = await runReflection();
    return `${r.adopted ? `adopted v${r.version}` : "not adopted"} (evals ${r.evalScore}%)`;
  });
  job("horizon scan", horizonExpr, async () => {
    const r = await scanHorizons();
    return `${r.created} new suggestion(s) (${r.engine})`;
  });

  console.log(
    `[argus] scheduler up — brief "${briefExpr}", memory "${memoryExpr}", reflection "${reflectExpr}", horizons "${horizonExpr}"${tz ? ` (${tz})` : " (system tz)"}`,
  );
}

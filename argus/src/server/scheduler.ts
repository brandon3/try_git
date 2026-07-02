import cron from "node-cron";
import { runBrief } from "@/engine/brief";
import { runReflection } from "@/engine/reflect";

// The 7am. Started once from instrumentation.ts when the server boots.
//
// Config (env):
//   ARGUS_CRON=0            disable scheduling entirely (dev/sandbox)
//   ARGUS_BRIEF_CRON        default "0 7 * * *"
//   ARGUS_REFLECT_CRON      default "30 3 * * *"
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
  const briefExpr = process.env.ARGUS_BRIEF_CRON ?? "0 7 * * *";
  const reflectExpr = process.env.ARGUS_REFLECT_CRON ?? "30 3 * * *";

  cron.schedule(
    briefExpr,
    async () => {
      try {
        const result = await runBrief("schedule");
        console.log(
          `[argus] scheduled brief ok: ${result.triaged} triaged, ${result.auto} auto (${result.engine})`,
        );
      } catch (err) {
        // Already recorded in the briefs table (surfaced on the dashboard);
        // log for journalctl too.
        console.error("[argus] scheduled brief failed:", err);
      }
    },
    tz ? { timezone: tz } : undefined,
  );

  cron.schedule(
    reflectExpr,
    async () => {
      try {
        const outcome = await runReflection();
        console.log(
          `[argus] reflection ${outcome.adopted ? `adopted v${outcome.version}` : "not adopted"} (evals ${outcome.evalScore}%)`,
        );
      } catch (err) {
        console.error("[argus] reflection failed:", err);
      }
    },
    tz ? { timezone: tz } : undefined,
  );

  console.log(
    `[argus] scheduler up — brief "${briefExpr}", reflection "${reflectExpr}"${tz ? ` (${tz})` : " (system tz)"}`,
  );
}

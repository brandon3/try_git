// Next.js runs this once when the server process starts — the right place
// to bring up the cron scheduler (and nothing else).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}

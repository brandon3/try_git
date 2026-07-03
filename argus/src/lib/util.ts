// Small shared primitives used across the engines.

export const DAY_MS = 86_400_000;

// Single-flight: while one invocation is in progress, concurrent callers share
// its promise instead of starting a second run. The first caller's arguments
// win; later callers that arrive mid-flight reuse the in-progress result. Used
// to coalesce overlapping brief/reflection/horizon runs (e.g. cron firing while
// the button is tapped).
export function singleFlight<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return (...args: A) => {
    if (!inFlight) {
      inFlight = fn(...args).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

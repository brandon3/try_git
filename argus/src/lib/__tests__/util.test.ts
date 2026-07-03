import { describe, it, expect } from "vitest";
import { singleFlight } from "../util";

// singleFlight is load-bearing: the brief, reflection, and horizon engines all
// rely on it to coalesce overlapping runs. These pin its contract.

describe("singleFlight", () => {
  it("shares one in-flight run across concurrent callers (first args win)", async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const wrapped = singleFlight(async (label: string) => {
      calls++;
      return `${label}:${await gate}`;
    });

    const a = wrapped("first");
    const b = wrapped("second"); // arrives mid-flight → shares a's run
    release("done");
    expect(await a).toBe("first:done");
    expect(await b).toBe("first:done"); // second's args ignored while in flight
    expect(calls).toBe(1); // only one underlying run
  });

  it("starts a fresh run once the previous settled", async () => {
    let calls = 0;
    const wrapped = singleFlight(async () => {
      calls++;
      return calls;
    });
    expect(await wrapped()).toBe(1);
    expect(await wrapped()).toBe(2); // sequential → not coalesced
  });

  it("clears the lock even when the run rejects", async () => {
    let calls = 0;
    const wrapped = singleFlight(async () => {
      calls++;
      throw new Error("boom");
    });
    await expect(wrapped()).rejects.toThrow("boom");
    await expect(wrapped()).rejects.toThrow("boom"); // lock released, runs again
    expect(calls).toBe(2);
  });
});

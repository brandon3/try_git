import { describe, it, expect } from "vitest";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  buildHorizonContext,
  scanHorizons,
  respondHorizon,
  openHorizons,
  savedHorizons,
} from "../horizons";

// Horizons — the proactive life-expansion engine. These pin down that
// suggestions are grounded in real signal, don't pile up, and that save/dismiss
// trains taste for the next scan.

function seedEvent(daysOut: number, title: string) {
  const when = new Date(Date.now() + daysOut * 864e5);
  return db
    .insert(schema.items)
    .values({
      sourceId: 1,
      externalId: `ev-${title}-${daysOut}`,
      kind: "event",
      title,
      from: "calendar",
      occursAt: when,
      status: "triaged",
      createdAt: new Date(),
    })
    .run();
}

describe("horizons — context", () => {
  it("finds free weekend openings and starved enriching dimensions", () => {
    // A calendar of pure obligations, no happiness/relationships activity.
    const ctx = buildHorizonContext();
    expect(ctx.starved).toContain("happiness");
    expect(ctx.starved).toContain("relationships");
    // With an empty calendar, upcoming weekends read as open.
    expect(ctx.openings.length).toBeGreaterThan(0);
  });

  it("does not report a weekend as open when an event sits on it", () => {
    // Fill the next Saturday with an event.
    const now = new Date();
    let sat = new Date(now);
    while (sat.getDay() !== 6) sat = new Date(sat.getTime() + 864e5);
    const daysOut = Math.round((sat.getTime() - now.getTime()) / 864e5);
    seedEvent(daysOut, "All-day offsite");
    const label = sat.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const ctx = buildHorizonContext();
    expect(ctx.openings).not.toContain(`Free ${label}`);
  });
});

describe("horizons — scan lifecycle", () => {
  it("generates grounded suggestions and never proposes a booking as the first step", async () => {
    const result = await scanHorizons();
    expect(result.created).toBeGreaterThan(0);
    const open = openHorizons();
    expect(open.length).toBeGreaterThan(0);
    for (const h of open) {
      expect(h.rationale.length).toBeGreaterThan(20); // must justify itself
      expect(h.firstStep.length).toBeGreaterThan(0);
      expect(h.firstStep.toLowerCase()).not.toMatch(/\bbook(ed|ing)?\b|\bpay\b|\bpurchase\b/);
    }
  });

  it("caps open suggestions — a horizon is an invitation, not a backlog", async () => {
    await scanHorizons();
    await scanHorizons();
    expect(openHorizons().length).toBeLessThanOrEqual(4);
  });

  it("save trains taste and moves the item out of the open set", async () => {
    const first = openHorizons()[0];
    expect(respondHorizon(first.id, "saved")).toBe(true);
    expect(openHorizons().find((h) => h.id === first.id)).toBeUndefined();
    expect(savedHorizons().find((h) => h.id === first.id)).toBeDefined();

    // Taste now reflects the save.
    const ctx = buildHorizonContext();
    expect(ctx.taste.some((t) => t.startsWith("liked:"))).toBe(true);

    // Answering an already-answered horizon is rejected.
    expect(respondHorizon(first.id, "dismissed")).toBe(false);
  });

  it("snooze means later, not never — a lapsed snooze re-opens on the next scan", async () => {
    const target = openHorizons()[0];
    expect(respondHorizon(target.id, "snoozed")).toBe(true);
    expect(openHorizons().find((h) => h.id === target.id)).toBeUndefined();

    // Backdate the snooze past the cooldown, as if two weeks have passed.
    db.update(schema.horizons)
      .set({ respondedAt: new Date(Date.now() - 15 * 864e5) })
      .where(eq(schema.horizons.id, target.id))
      .run();

    await scanHorizons();
    const reopened = openHorizons().find((h) => h.id === target.id);
    expect(reopened).toBeDefined();
    expect(reopened!.status).toBe("open");

    // A FRESH snooze stays resting through a scan.
    expect(respondHorizon(target.id, "snoozed")).toBe(true);
    await scanHorizons();
    expect(openHorizons().find((h) => h.id === target.id)).toBeUndefined();
  });
});

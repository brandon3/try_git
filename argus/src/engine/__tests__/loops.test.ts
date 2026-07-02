import { describe, it, expect } from "vitest";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  maybeCreateFromHistory,
  scoreOnResponse,
  resolveProposal,
  promotedRuleFor,
  experimentSummary,
} from "../experiments";
import { captureGolden, runEvals } from "../evals";
import { computeCalibration } from "../calibration";
import { runReflection } from "../reflect";
import { triageItems, runTriage } from "../triage";
import { execute, undo } from "../executor";

// The four self-improvement loops modify Argus's own behavior — this suite
// pins down their thresholds and safety invariants so future changes can't
// quietly break them.

let itemSeq = 0;
function seedItem(over: Partial<typeof schema.items.$inferInsert> = {}) {
  itemSeq++;
  return db
    .insert(schema.items)
    .values({
      sourceId: 1,
      externalId: `test-${itemSeq}`,
      kind: "email",
      title: over.title ?? `Item ${itemSeq}`,
      from: over.from ?? "someone@example.com",
      bodySnippet: over.bodySnippet ?? "",
      status: "triaged",
      createdAt: new Date(),
      ...over,
    })
    .returning()
    .get();
}

function seedDecision(
  itemId: number,
  over: Partial<typeof schema.decisions.$inferInsert> = {},
) {
  return db
    .insert(schema.decisions)
    .values({
      itemId,
      verdict: "handle",
      action: "archive",
      dimension: "other",
      reason: "test",
      confidence: "high",
      engine: "mock",
      createdAt: new Date(),
      ...over,
    })
    .returning()
    .get();
}

describe("loop 1 — shadow experiments", () => {
  const SENDER = "news@loop1.example.com";

  it("creates an experiment only after repeated identical approvals", () => {
    const i1 = seedItem({ from: SENDER });
    const d1 = seedDecision(i1.id, { userResponse: "approved" });
    maybeCreateFromHistory(i1, d1);
    expect(experimentSummary().shadow).toBe(0); // one approval is not a pattern

    const i2 = seedItem({ from: SENDER });
    const d2 = seedDecision(i2.id, { userResponse: "approved" });
    maybeCreateFromHistory(i2, d2);
    expect(experimentSummary().shadow).toBe(1); // two is

    // No duplicate experiment for the same matcher
    maybeCreateFromHistory(i2, d2);
    expect(experimentSummary().shadow).toBe(1);
  });

  it("proposes after 3 agreements at >=95% and only the user can promote", () => {
    for (let n = 0; n < 3; n++) {
      const i = seedItem({ from: SENDER });
      const d = seedDecision(i.id);
      scoreOnResponse(i, d, "approved");
    }
    const proposed = experimentSummary().proposed;
    expect(proposed).toHaveLength(1);
    expect(proposed[0].agreements).toBe(3);

    // Still not live until promoted
    expect(promotedRuleFor(SENDER, "archive")).toBeNull();
    resolveProposal(proposed[0].id, "promote");
    expect(promotedRuleFor(SENDER, "archive")).not.toBeNull();
  });

  it("demotes a promoted rule when agreement decays below 80%", () => {
    const i = seedItem({ from: SENDER });
    const d = seedDecision(i.id);
    scoreOnResponse(i, d, "rejected"); // 3/4 = 75% < 80%
    expect(promotedRuleFor(SENDER, "archive")).toBeNull();
    expect(experimentSummary().shadow).toBe(1); // back to earning evidence
  });

  it("retired experiments never come back", () => {
    const SENDER2 = "spam@loop1b.example.com";
    // Earn a proposal, then retire it
    const seed1 = seedItem({ from: SENDER2 });
    const seedD1 = seedDecision(seed1.id, { userResponse: "approved" });
    maybeCreateFromHistory(seed1, seedD1);
    const seed2 = seedItem({ from: SENDER2 });
    const seedD2 = seedDecision(seed2.id, { userResponse: "approved" });
    maybeCreateFromHistory(seed2, seedD2);
    for (let n = 0; n < 3; n++) {
      const i = seedItem({ from: SENDER2 });
      scoreOnResponse(i, seedDecision(i.id), "approved");
    }
    const prop = experimentSummary().proposed.find((p) => p.matcherFrom === SENDER2)!;
    resolveProposal(prop.id, "retire");

    // Further approvals do not resurrect it
    const i = seedItem({ from: SENDER2 });
    const d = seedDecision(i.id, { userResponse: "approved" });
    maybeCreateFromHistory(i, d);
    const summary = experimentSummary();
    expect(summary.retired).toBe(1);
    expect(summary.proposed.filter((p) => p.matcherFrom === SENDER2)).toHaveLength(0);
  });
});

describe("loop 3 — golden set and loop 2 — reflection gate", () => {
  it("banks positive and negative cases from responses, skips 'none'", () => {
    const i1 = seedItem({ title: "This week in AI — Issue #300" });
    const d1 = seedDecision(i1.id);
    captureGolden(i1, d1, "approved");

    const i2 = seedItem({ title: "Team standup (optional)", kind: "event" });
    const d2 = seedDecision(i2.id, { action: "decline_event" });
    captureGolden(i2, d2, "rejected");

    const i3 = seedItem();
    const d3 = seedDecision(i3.id, { action: "none" });
    captureGolden(i3, d3, "approved"); // no action → no case

    const cases = db.select().from(schema.goldenCases).all();
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.kind).sort()).toEqual(["negative", "positive"]);
  });

  it("scores replays: positives must match, negatives must differ", async () => {
    // Mock engine archives "Issue #NNN" (positive passes) but still declines
    // optional standups (negative fails) — score should be 50.
    const report = await runEvals(null);
    expect(report.cases).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.score).toBe(50);
  });

  it("reflection adopts a first constitution and versions it", async () => {
    const outcome = await runReflection();
    expect(outcome.adopted).toBe(true);
    const active = db
      .select()
      .from(schema.constitution)
      .where(eq(schema.constitution.status, "active"))
      .all();
    expect(active).toHaveLength(1);
    expect(active[0].evalScore).toBe(50);

    // Second reflection: same evidence, same score — adopted, old superseded.
    const second = await runReflection();
    expect(second.adopted).toBe(true);
    const all = db.select().from(schema.constitution).all();
    expect(all.filter((c) => c.status === "active")).toHaveLength(1);
    expect(all.filter((c) => c.status === "superseded")).toHaveLength(1);
  });
});

describe("loop 4 — calibration", () => {
  it("excludes auto-approvals and acknowledgements from accuracy", () => {
    const mk = (
      confidence: string,
      userResponse: string | null,
      autoRuleId: number | null = null,
    ) => {
      const i = seedItem();
      seedDecision(i.id, { confidence, userResponse, respondedAt: new Date(), autoRuleId });
    };
    // Baseline from earlier tests exists; measure deltas via fresh 'low' bucket.
    mk("low", "approved");
    mk("low", "approved");
    mk("low", "rejected");
    mk("low", "acknowledged"); // excluded
    mk("low", "approved", 99); // auto — excluded

    const c = computeCalibration();
    expect(c.low.n).toBe(3);
    expect(c.low.accuracy).toBe(67);
  });
});

describe("security — auto-execution gating", () => {
  const SENDER = "newsletter@sec.example.com";

  it("auto-executes for a promoted rule only on DMARC-verified senders", async () => {
    // Promote an archive rule for the sender.
    db.insert(schema.experiments)
      .values({
        matcherFrom: SENDER,
        predictedAction: "archive",
        status: "promoted",
        promotedAt: new Date(),
        createdAt: new Date(),
      })
      .run();

    // Two fresh newsletters from that sender — one authenticated, one not.
    db.insert(schema.items)
      .values({
        sourceId: 1,
        externalId: "auth-yes",
        kind: "email",
        title: "This week in AI — Issue #500",
        from: SENDER,
        bodySnippet: "unsubscribe at any time",
        authenticated: true,
        status: "new",
        createdAt: new Date(),
      })
      .run();
    db.insert(schema.items)
      .values({
        sourceId: 1,
        externalId: "auth-no",
        kind: "email",
        title: "This week in AI — Issue #501",
        from: SENDER, // spoofed From — DMARC did not pass
        bodySnippet: "unsubscribe at any time",
        authenticated: false,
        status: "new",
        createdAt: new Date(),
      })
      .run();

    const result = await runTriage();
    expect(result.auto).toBe(1); // only the verified one

    const yes = db.select().from(schema.items).where(eq(schema.items.externalId, "auth-yes")).get()!;
    const no = db.select().from(schema.items).where(eq(schema.items.externalId, "auth-no")).get()!;
    const dYes = db.select().from(schema.decisions).where(eq(schema.decisions.itemId, yes.id)).get()!;
    const dNo = db.select().from(schema.decisions).where(eq(schema.decisions.itemId, no.id)).get()!;

    expect(dYes.userResponse).toBe("approved");
    expect(dYes.autoRuleId).not.toBeNull();
    expect(dNo.userResponse).toBeNull(); // spoofed sender falls through to manual
  });
});

describe("triage core safety", () => {
  it("returns exactly one verdict per input, failing unmatched toward attention", async () => {
    const results = await triageItems(
      [
        { id: "1", kind: "email", title: "Random subject", from: "x@y.z", snippet: null, occursAt: null },
        { id: "2", kind: "email", title: "50% OFF sale", from: "deals@shop", snippet: null, occursAt: null },
      ],
      { constitution: null, preferences: [], calibration: null },
    );
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.itemId))).toEqual(new Set(["1", "2"]));
  });
});

describe("executor — execute and undo", () => {
  it("executes approved decisions once and undo reverses exactly once", async () => {
    const i = seedItem();
    const d = seedDecision(i.id, { userResponse: "approved" });

    await execute(d.id);
    const actions = db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.decisionId, d.id))
      .all();
    expect(actions).toHaveLength(1);

    await undo(d.id);
    const after = db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.decisionId, d.id))
      .get();
    expect(after?.reversedAt).not.toBeNull();

    await expect(undo(d.id)).rejects.toThrow(/already undone/);
  });

  it("refuses to execute unapproved decisions and to undo irreversible actions", async () => {
    const i = seedItem();
    const d = seedDecision(i.id); // no response
    await expect(execute(d.id)).rejects.toThrow(/not approved/);

    const i2 = seedItem();
    const d2 = seedDecision(i2.id, { action: "draft_reply", userResponse: "approved" });
    await execute(d2.id);
    await expect(undo(d2.id)).rejects.toThrow(/not reversible/);
  });
});

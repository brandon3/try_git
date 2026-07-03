import { describe, it, expect } from "vitest";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { runReflection } from "../reflect";
import { scoreOnResponse, demoteRule, promotedRuleFor } from "../experiments";

// Regression suite for two correctness bugs found in the self-improvement
// loops — both only manifest after real, long-term use (never in the mock
// happy-path), which is exactly why they need pinning here.

// Seed golden cases so the mock engine scores the set at exactly 50%:
// a positive "Issue #NNN" the mock archives (passes) and a negative optional
// standup the mock still declines (fails).
function seedFiftyPercentGoldenSet() {
  db.insert(schema.goldenCases)
    .values({
      itemJson: JSON.stringify({
        kind: "email",
        title: "This week in AI — Issue #300",
        from: "news@example.com",
        snippet: "",
      }),
      kind: "positive",
      action: "archive",
      decisionId: 1,
      createdAt: new Date(),
    })
    .run();
  db.insert(schema.goldenCases)
    .values({
      itemJson: JSON.stringify({
        kind: "event",
        title: "Team standup (optional)",
        from: "boss@example.com",
        snippet: "",
      }),
      kind: "negative",
      action: "decline_event",
      decisionId: 2,
      createdAt: new Date(),
    })
    .run();
}

describe("loop 2 — the eval gate grades the incumbent on the current golden set", () => {
  it("does not freeze adoption when the incumbent's stored score is stale/inflated", async () => {
    seedFiftyPercentGoldenSet();

    // An active constitution whose stored evalScore (100) was recorded against
    // an earlier, smaller golden set. On today's set it really scores 50.
    db.insert(schema.constitution)
      .values({
        content: "- old rule",
        rationale: "seeded incumbent",
        evalScore: 100, // stale: graded a different, smaller exam
        status: "active",
        createdAt: new Date(),
      })
      .run();

    // Evidence so reflection has something to distill.
    const item = db
      .insert(schema.items)
      .values({
        sourceId: 1,
        externalId: "reg-1",
        kind: "email",
        title: "This week in AI — Issue #301",
        from: "news@example.com",
        bodySnippet: "",
        status: "triaged",
        createdAt: new Date(),
      })
      .returning()
      .get();
    db.insert(schema.decisions)
      .values({
        itemId: item.id,
        verdict: "handle",
        action: "archive",
        dimension: "other",
        reason: "test",
        confidence: "high",
        engine: "mock",
        userResponse: "approved",
        respondedAt: new Date(),
        createdAt: new Date(),
      })
      .run();

    const outcome = await runReflection();

    // With the stale-baseline bug, baseline would be 100 and the candidate (50)
    // would be REJECTED — adoption frozen. Re-grading the incumbent on today's
    // set yields 50, so the candidate (50) is a non-regression and is adopted.
    expect(outcome.adopted).toBe(true);
    expect(outcome.previousScore).toBe(50); // recomputed, not the stored 100
  });
});

describe("loop 1 — an undo of an auto-execution demotes the rule immediately", () => {
  const SENDER = "auto@demote.example.com";

  it("demotes on undo where the lifetime agreement rate alone would not", () => {
    // A well-established promoted rule: 100 hits, 100 agreements.
    const rule = db
      .insert(schema.experiments)
      .values({
        matcherFrom: SENDER,
        predictedAction: "archive",
        hits: 100,
        agreements: 100,
        status: "promoted",
        promotedAt: new Date(),
        createdAt: new Date(),
      })
      .returning()
      .get();

    const item = db
      .insert(schema.items)
      .values({
        sourceId: 1,
        externalId: "demote-1",
        kind: "email",
        title: "Newsletter",
        from: SENDER,
        bodySnippet: "",
        authenticated: true,
        status: "triaged",
        createdAt: new Date(),
      })
      .returning()
      .get();
    const decision = db
      .insert(schema.decisions)
      .values({
        itemId: item.id,
        verdict: "handle",
        action: "archive",
        dimension: "other",
        reason: "auto",
        confidence: "high",
        engine: "mock",
        userResponse: "approved",
        respondedAt: new Date(),
        autoRuleId: rule.id,
        createdAt: new Date(),
      })
      .returning()
      .get();

    // The undo route records the disagreement via scoreOnResponse first…
    scoreOnResponse(item, decision, "rejected");
    // …but the lifetime rate (100/101 ≈ 0.99) stays well above the 0.8 demote
    // threshold, so the rule is still promoted. This is the bug being pinned.
    expect(promotedRuleFor(SENDER, "archive")).not.toBeNull();

    // The explicit demotion on undo is what actually withdraws autonomy.
    demoteRule(decision.autoRuleId!);
    expect(promotedRuleFor(SENDER, "archive")).toBeNull();

    const after = db
      .select()
      .from(schema.experiments)
      .where(eq(schema.experiments.id, rule.id))
      .get()!;
    expect(after.status).toBe("shadow"); // back to earning its evidence
    expect(after.promotedAt).toBeNull();
  });
});

import { db, schema } from "@/db";
import { triageItems, type TriageInput } from "./triage";

// Loop 3 — golden set: the user's own responses become the regression suite
// that gates every future change to the triage prompt/constitution. The
// system's past mistakes police its future self-modifications.

type ItemSnapshot = {
  kind: string;
  title: string;
  from: string | null;
  snippet: string | null;
};

// Called from the decisions route on every manual response.
// approved  → positive case: on this item, this action was right.
// rejected  → negative case: on this item, this action was wrong.
// acknowledged carries no action signal, so it banks nothing.
export function captureGolden(
  item: { kind: string; title: string; from: string | null; bodySnippet: string | null },
  decision: { id: number; action: string },
  response: string,
): void {
  if (decision.action === "none") return;
  if (response !== "approved" && response !== "rejected") return;

  const snapshot: ItemSnapshot = {
    kind: item.kind,
    title: item.title,
    from: item.from,
    snippet: item.bodySnippet,
  };
  db.insert(schema.goldenCases)
    .values({
      itemJson: JSON.stringify(snapshot),
      kind: response === "approved" ? "positive" : "negative",
      action: decision.action,
      decisionId: decision.id,
      createdAt: new Date(),
    })
    .run();
}

export type EvalReport = {
  cases: number;
  passed: number;
  score: number; // 0-100; 100 when there are no cases yet (nothing to violate)
};

// Replay the golden set through the triage core under a candidate
// constitution. Pure shadow: no decisions are persisted.
export async function runEvals(candidateConstitution: string | null): Promise<EvalReport> {
  const cases = db.select().from(schema.goldenCases).all();
  if (cases.length === 0) return { cases: 0, passed: 0, score: 100 };

  const inputs: TriageInput[] = cases.map((c, idx) => {
    const snap = JSON.parse(c.itemJson) as ItemSnapshot;
    return {
      id: `golden-${idx}`,
      kind: snap.kind,
      title: snap.title,
      from: snap.from,
      snippet: snap.snippet,
      occursAt: null,
    };
  });

  const results = await triageItems(inputs, {
    constitution: candidateConstitution,
    preferences: [],
    calibration: null,
  });
  const byId = new Map(results.map((r) => [r.itemId, r]));

  let passed = 0;
  cases.forEach((c, idx) => {
    const r = byId.get(`golden-${idx}`);
    if (!r) return;
    if (c.kind === "positive" ? r.action === c.action : r.action !== c.action) {
      passed++;
    }
  });

  return {
    cases: cases.length,
    passed,
    score: Math.round((passed / cases.length) * 100),
  };
}

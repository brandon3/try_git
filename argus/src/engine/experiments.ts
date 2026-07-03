import { db, schema } from "@/db";
import { and, eq, inArray } from "drizzle-orm";

// Loop 1 — shadow experiments. An automation candidate is born from observed
// approvals, runs silently against the user's real decisions, and only
// becomes a live rule when (a) the evidence threshold is met AND (b) the
// user explicitly promotes it. Nothing self-promotes.

// Evidence thresholds (deliberately low for the sandbox; raise at home).
const CREATE_AFTER_APPROVALS = 2; // identical approvals before a shadow experiment is born
const PROPOSE_MIN_AGREEMENTS = 3; // shadow agreements before proposing promotion
const PROPOSE_MIN_RATE = 0.95;
const DEMOTE_RATE = 0.8; // promoted rules falling under this demote themselves

// Only reversible actions may ever run without a tap. Outward-facing or
// content-bearing actions (event responses, drafts) stay manual even when
// a rule is promoted.
export const AUTO_SAFE_ACTIONS = ["archive", "label", "flag"];

type Experiment = typeof schema.experiments.$inferSelect;

function matches(exp: Experiment, from: string | null): boolean {
  return !!from && exp.matcherFrom === from;
}

export function promotedRuleFor(
  from: string | null,
  action: string,
): Experiment | null {
  if (!from) return null;
  const rule = db
    .select()
    .from(schema.experiments)
    .where(
      and(
        eq(schema.experiments.status, "promoted"),
        eq(schema.experiments.matcherFrom, from),
        eq(schema.experiments.predictedAction, action),
      ),
    )
    .get();
  return rule ?? null;
}

// Score every live experiment that matches this item against the user's
// actual response. Called only for MANUAL responses — auto-approvals carry
// no human signal and must not feed the loop that justifies them.
export function scoreOnResponse(
  item: { from: string | null },
  decision: { action: string },
  response: string,
): void {
  const live = db
    .select()
    .from(schema.experiments)
    .where(inArray(schema.experiments.status, ["shadow", "proposed", "promoted"]))
    .all();

  for (const exp of live) {
    if (!matches(exp, item.from)) continue;

    const agreed = exp.predictedAction === decision.action && response === "approved";
    const hits = exp.hits + 1;
    const agreements = exp.agreements + (agreed ? 1 : 0);
    const rate = agreements / hits;

    let status = exp.status;
    if (exp.status === "shadow" && agreements >= PROPOSE_MIN_AGREEMENTS && rate >= PROPOSE_MIN_RATE) {
      status = "proposed";
    } else if (exp.status === "promoted" && rate < DEMOTE_RATE) {
      // The user's behavior changed; the rule demotes itself back to shadow
      // and has to re-earn its evidence.
      status = "shadow";
    }

    db.update(schema.experiments)
      .set({ hits, agreements, status, ...(status === "shadow" && exp.status === "promoted" ? { promotedAt: null } : {}) })
      .where(eq(schema.experiments.id, exp.id))
      .run();
  }
}

// An undo of a rule's own auto-execution is the strongest "that was wrong"
// signal there is — and the only reliable one a promoted rule ever gets, since
// auto-approvals bypass scoreOnResponse() and its lifetime agreement rate
// barely moves (a 100/100 rule would need ~25 undos to decay under 80%). Per
// the trust ladder — autonomy is slow to earn, fast to lose — a single undo
// demotes the rule straight back to shadow, where it must re-earn its evidence
// before it can act unattended again. Called from the undo route with the exact
// rule that fired (decisions.autoRuleId), so only that rule is affected.
export function demoteRule(ruleId: number): void {
  const exp = db
    .select()
    .from(schema.experiments)
    .where(eq(schema.experiments.id, ruleId))
    .get();
  if (!exp || exp.status !== "promoted") return;
  db.update(schema.experiments)
    .set({ status: "shadow", promotedAt: null })
    .where(eq(schema.experiments.id, ruleId))
    .run();
}

// After an approval, check whether a pattern has emerged worth shadowing:
// the same sender + same action approved CREATE_AFTER_APPROVALS times.
export function maybeCreateFromHistory(
  item: { from: string | null },
  decision: { action: string },
): void {
  if (!item.from || decision.action === "none") return;

  const existing = db
    .select()
    .from(schema.experiments)
    .where(
      and(
        eq(schema.experiments.matcherFrom, item.from),
        eq(schema.experiments.predictedAction, decision.action),
      ),
    )
    .get();
  if (existing) return; // one lifetime per matcher — retired stays retired

  const approvals = db
    .select({ id: schema.decisions.id })
    .from(schema.decisions)
    .innerJoin(schema.items, eq(schema.decisions.itemId, schema.items.id))
    .where(
      and(
        eq(schema.items.from, item.from),
        eq(schema.decisions.action, decision.action),
        eq(schema.decisions.userResponse, "approved"),
      ),
    )
    .all().length;

  if (approvals >= CREATE_AFTER_APPROVALS) {
    db.insert(schema.experiments)
      .values({
        matcherFrom: item.from,
        predictedAction: decision.action,
        createdAt: new Date(),
      })
      .run();
  }
}

// User verdict on a proposed promotion.
export function resolveProposal(
  id: number,
  verdict: "promote" | "retire",
): Experiment | null {
  const exp = db
    .select()
    .from(schema.experiments)
    .where(eq(schema.experiments.id, id))
    .get();
  if (!exp || exp.status !== "proposed") return null;

  db.update(schema.experiments)
    .set(
      verdict === "promote"
        ? { status: "promoted", promotedAt: new Date() }
        : { status: "retired" },
    )
    .where(eq(schema.experiments.id, id))
    .run();
  return { ...exp, status: verdict === "promote" ? "promoted" : "retired" };
}

export function experimentSummary() {
  const all = db.select().from(schema.experiments).all();
  return {
    shadow: all.filter((e) => e.status === "shadow").length,
    proposed: all
      .filter((e) => e.status === "proposed")
      .map((e) => ({
        id: e.id,
        matcherFrom: e.matcherFrom,
        predictedAction: e.predictedAction,
        agreements: e.agreements,
        hits: e.hits,
      })),
    promoted: all
      .filter((e) => e.status === "promoted")
      .map((e) => ({
        id: e.id,
        matcherFrom: e.matcherFrom,
        predictedAction: e.predictedAction,
        agreements: e.agreements,
        hits: e.hits,
      })),
    retired: all.filter((e) => e.status === "retired").length,
  };
}

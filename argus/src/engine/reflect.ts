import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db, schema } from "@/db";
import { desc, eq, isNotNull } from "drizzle-orm";
import { runEvals } from "./evals";

// Loop 2 — nightly reflection: a second pass reviews the user's overrides
// and rewrites the constitution (the distilled "how this user wants their
// life run" injected into every triage). Adoption is gated by the golden
// set (loop 3): a rewrite that would regress past decisions is rejected.
// Every version is kept; nothing is edited invisibly.

const Reflection = z.object({
  constitution: z.string(),
  rationale: z.string(),
});

const REFLECT_SYSTEM = `You maintain the "constitution" for Argus, a personal
chief-of-staff agent: a short bulleted document distilling how this user wants
their life run, injected into every future triage.

You are given the current constitution and the user's recent responses to
Argus's decisions (approvals, rejections, and their stated reasons). Rewrite
the constitution to absorb what the responses teach:
- Rejections and notes are the strongest signal — turn them into durable rules.
- Keep it under 15 bullets. Merge, generalize, and drop stale rules.
- Plain declarative language ("Decline optional meetings" not "consider...").
- Never invent rules the evidence doesn't support.
Return the full new constitution and a one-paragraph rationale for what
changed and why.`;

export type ReflectionOutcome = {
  adopted: boolean;
  version?: number;
  rationale: string;
  evalScore: number;
  previousScore: number | null;
};

export async function runReflection(): Promise<ReflectionOutcome> {
  const active = db
    .select()
    .from(schema.constitution)
    .where(eq(schema.constitution.status, "active"))
    .orderBy(desc(schema.constitution.id))
    .get();

  // Evidence: responded decisions with item context, newest first, capped.
  const responded = db
    .select({ decision: schema.decisions, item: schema.items })
    .from(schema.decisions)
    .innerJoin(schema.items, eq(schema.decisions.itemId, schema.items.id))
    .where(isNotNull(schema.decisions.userResponse))
    .orderBy(desc(schema.decisions.respondedAt))
    .limit(100)
    .all();
  const notes = db
    .select()
    .from(schema.preferences)
    .orderBy(desc(schema.preferences.id))
    .limit(50)
    .all();

  if (responded.length === 0) {
    return {
      adopted: false,
      rationale: "No responded decisions yet — nothing to learn from.",
      evalScore: 0,
      previousScore: active?.evalScore ?? null,
    };
  }

  const draft = process.env.ANTHROPIC_API_KEY
    ? await reflectWithClaude(active?.content ?? null, responded, notes)
    : reflectWithMock(responded, notes);

  // The gate: replay the golden set under the candidate. Adopt only if it
  // doesn't regress what the current constitution scores.
  const candidateReport = await runEvals(draft.constitution);
  const baseline = active?.evalScore ?? null;

  if (baseline !== null && candidateReport.score < baseline) {
    db.insert(schema.constitution)
      .values({
        content: draft.constitution,
        rationale: `REJECTED by eval gate (scored ${candidateReport.score} vs baseline ${baseline}). ${draft.rationale}`,
        evalScore: candidateReport.score,
        status: "rejected",
        createdAt: new Date(),
      })
      .run();
    return {
      adopted: false,
      rationale: draft.rationale,
      evalScore: candidateReport.score,
      previousScore: baseline,
    };
  }

  if (active) {
    db.update(schema.constitution)
      .set({ status: "superseded" })
      .where(eq(schema.constitution.id, active.id))
      .run();
  }
  const row = db
    .insert(schema.constitution)
    .values({
      content: draft.constitution,
      rationale: draft.rationale,
      evalScore: candidateReport.score,
      status: "active",
      createdAt: new Date(),
    })
    .returning()
    .get();

  return {
    adopted: true,
    version: row.id,
    rationale: draft.rationale,
    evalScore: candidateReport.score,
    previousScore: baseline,
  };
}

type Evidence = { decision: typeof schema.decisions.$inferSelect; item: typeof schema.items.$inferSelect };

async function reflectWithClaude(
  current: string | null,
  responded: Evidence[],
  notes: (typeof schema.preferences.$inferSelect)[],
): Promise<z.infer<typeof Reflection>> {
  const client = new Anthropic();
  const evidence = responded.map(({ decision, item }) => ({
    item: { kind: item.kind, title: item.title, from: item.from },
    argus: { verdict: decision.verdict, action: decision.action, reason: decision.reason },
    user: decision.userResponse,
  }));

  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(Reflection) },
    system: [{ type: "text", text: REFLECT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `Current constitution:\n${current ?? "(none yet)"}\n\n` +
          `User notes:\n${notes.map((n) => `- ${n.note}`).join("\n") || "(none)"}\n\n` +
          `Recent decisions and responses:\n${JSON.stringify(evidence, null, 2)}`,
      },
    ],
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Reflection failed schema validation");
  return parsed;
}

// Sandbox reflection: deterministic distillation of the same evidence.
function reflectWithMock(
  responded: Evidence[],
  notes: (typeof schema.preferences.$inferSelect)[],
): z.infer<typeof Reflection> {
  const bullets = new Set<string>();

  for (const { decision, item } of responded) {
    if (decision.userResponse === "rejected") {
      bullets.add(`Do not "${decision.action}" items from ${item.from ?? "unknown senders"} — the user rejected this.`);
    }
    if (decision.userResponse === "approved" && decision.action !== "none") {
      bullets.add(`"${decision.action}" is welcome for items like "${item.title.slice(0, 40)}".`);
    }
  }
  for (const n of notes.slice(0, 5)) {
    bullets.add(`User note: ${n.note}`);
  }

  const list = [...bullets].slice(0, 15);
  return {
    constitution: list.map((b) => `- ${b}`).join("\n"),
    rationale: `Distilled ${responded.length} responses and ${notes.length} notes into ${list.length} rules (mock reflection).`,
  };
}

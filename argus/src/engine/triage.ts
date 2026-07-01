import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

// The model only ever proposes actions from this enum — it cannot invent
// side effects, and irreversible actions (send, delete) are not in it.
const ACTION = z.enum([
  "none",
  "archive",
  "label",
  "draft_reply",
  "accept_event",
  "decline_event",
  "flag",
]);

const TriageItem = z.object({
  itemId: z.string(),
  verdict: z.enum(["needs_you", "handle", "ignore"]),
  action: ACTION,
  reason: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
});

const TriageBatch = z.object({ triages: z.array(TriageItem) });

// Persona + policy. Stable text so the prompt-cache breakpoint holds;
// the current date and items go in the user turn, never here.
const SYSTEM_PROMPT = `You are Argus, a personal chief of staff named for the
hundred-eyed watchman of Greek myth: vigilant, understated, never dramatic.
You watch the user's inboxes and calendar so they don't have to.

Triage each item into exactly one verdict:
- "needs_you": genuinely requires the user's attention or judgment
  (deadlines, security alerts, conflicts, personal requests, money changes).
- "handle": routine and you can propose a concrete safe action
  (archive a promo, draft a short reply, accept a conflict-free event).
- "ignore": noise; propose "archive" or "none".

Rules:
- Fail toward attention: if unsure, use "needs_you" with confidence "low".
- Reasons are one short sentence, plain language, no drama.
- Calendar conflicts are always "needs_you" — you may suggest, never decide,
  which commitment loses.
- Security alerts are always "needs_you" with action "flag".`;

type PendingItem = typeof schema.items.$inferSelect;

export type TriageResult = z.infer<typeof TriageItem> & { engine: string };

async function triageWithClaude(
  pending: PendingItem[],
  preferenceNotes: string[],
): Promise<TriageResult[]> {
  const client = new Anthropic();

  const itemsPayload = pending.map((i) => ({
    itemId: String(i.id),
    kind: i.kind,
    title: i.title,
    from: i.from,
    snippet: i.bodySnippet,
    occursAt: i.occursAt?.toISOString() ?? null,
  }));

  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(TriageBatch),
    },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          `Current date: ${new Date().toISOString()}\n\n` +
          (preferenceNotes.length
            ? `Learned preferences:\n${preferenceNotes.map((n) => `- ${n}`).join("\n")}\n\n`
            : "") +
          `Triage these items:\n${JSON.stringify(itemsPayload, null, 2)}`,
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Triage response failed schema validation");
  return parsed.triages.map((t) => ({ ...t, engine: "claude-opus-4-8" }));
}

// Deterministic fallback so the full loop runs without an API key
// (sandbox, offline dev). Heuristics approximate the policy above.
function triageWithMock(pending: PendingItem[]): TriageResult[] {
  return pending.map((i) => {
    const text = `${i.title} ${i.bodySnippet ?? ""} ${i.from ?? ""}`.toLowerCase();
    const t = (r: Omit<TriageResult, "itemId" | "engine">): TriageResult => ({
      itemId: String(i.id),
      engine: "mock",
      ...r,
    });

    if (text.includes("security") || text.includes("sign-in"))
      return t({ verdict: "needs_you", action: "flag", confidence: "high", reason: "Security alert — verify this sign-in was you." });
    if (text.includes("conflict"))
      return t({ verdict: "needs_you", action: "none", confidence: "high", reason: "Two commitments overlap; one has to move." });
    if (text.includes("expires") || text.includes("renew"))
      return t({ verdict: "needs_you", action: "flag", confidence: "high", reason: "A deadline with late fees is approaching." });
    if (text.includes("price") || text.includes("increases"))
      return t({ verdict: "needs_you", action: "flag", confidence: "medium", reason: "A subscription is getting more expensive." });
    if (text.includes("rsvp") || text.includes("by friday") || text.includes("need your"))
      return t({ verdict: "needs_you", action: "draft_reply", confidence: "medium", reason: "Someone is waiting on you with a date attached." });
    if (text.includes("unsubscribe") || text.includes("newsletter"))
      return t({ verdict: "handle", action: "archive", confidence: "high", reason: "Newsletter — archived, still searchable." });
    if (text.includes("% off") || text.includes("sale"))
      return t({ verdict: "ignore", action: "archive", confidence: "high", reason: "Promotional blast." });
    if (i.kind === "event" && text.includes("optional"))
      return t({ verdict: "handle", action: "decline_event", confidence: "medium", reason: "Optional and agenda-less; reclaim the slot." });
    if (i.kind === "event")
      return t({ verdict: "handle", action: "accept_event", confidence: "medium", reason: "No conflict detected." });
    return t({ verdict: "needs_you", action: "none", confidence: "low", reason: "Unsure — flagging for your eyes." });
  });
}

export async function runTriage(): Promise<{ triaged: number; engine: string }> {
  const pending = db
    .select()
    .from(schema.items)
    .where(eq(schema.items.status, "new"))
    .all();
  if (pending.length === 0) return { triaged: 0, engine: "none" };

  const preferenceNotes = db
    .select()
    .from(schema.preferences)
    .all()
    .map((p) => p.note);

  const useClaude = !!process.env.ANTHROPIC_API_KEY;
  const results = useClaude
    ? await triageWithClaude(pending, preferenceNotes)
    : triageWithMock(pending);

  for (const r of results) {
    db.insert(schema.decisions)
      .values({
        itemId: Number(r.itemId),
        verdict: r.verdict,
        action: r.action,
        reason: r.reason,
        confidence: r.confidence,
        engine: r.engine,
        createdAt: new Date(),
      })
      .run();
    db.update(schema.items)
      .set({ status: "triaged" })
      .where(eq(schema.items.id, Number(r.itemId)))
      .run();
  }
  return { triaged: results.length, engine: useClaude ? "claude-opus-4-8" : "mock" };
}

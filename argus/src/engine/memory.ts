import { db, schema } from "@/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { DAY_MS, singleFlight } from "@/lib/util";

// Loop 5 — memory consolidation ("sleep-time" hygiene). The learning loops
// write memory; this loop keeps it healthy. Runs before each reflection so the
// constitution is always distilled from clean memory. Implements the memory-
// lifecycle guardrails the 2026 literature converged on (OWASP ASI06 defense):
// provenance/trust tagging, deduplication + reinforcement, decay of stale
// low-trust memory, quarantine of likely-poisoned memory, conflict detection,
// and a recorded health score so drift is visible as a trend.
//
// Trust levels (set at write time):
//   'user'      — the user typed it or explicitly undid an action. Durable.
//   'inferred'  — Argus summarized it from a user response. Decays if unused.
//   'untrusted' — derived from email/calendar content. Quarantine-eligible.
//
// Only 'active' preferences are ever injected into a prompt (trust-aware
// retrieval): decayed and quarantined memory stays for audit but never steers.

const DECAY_DAYS = 45; // inferred memory unused this long ages out
const QUARANTINE_MIN_CONTRA = 3; // golden cases contradicting a note to quarantine it

type Pref = typeof schema.preferences.$inferSelect;

// A coarse fingerprint for dedup: same note modulo case/whitespace/trailing
// punctuation counts as the same memory.
function fingerprint(note: string): string {
  return note.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

// Does an active golden case contradict this note? A note that says
// "'archive' is welcome for X" is contradicted by negative (rejected) golden
// cases for the archive action, and vice-versa. Deliberately conservative —
// only counts when the note names an action the golden set disagrees with.
function contradictions(note: string): number {
  const cases = db.select().from(schema.goldenCases).all();
  let n = 0;
  for (const c of cases) {
    const mentions = note.toLowerCase().includes(c.action.toLowerCase());
    if (!mentions) continue;
    const noteApproves = /welcome|do "|approve/i.test(note);
    const noteRejects = /do not|don't|reject|undid/i.test(note);
    if (c.kind === "negative" && noteApproves) n++;
    if (c.kind === "positive" && noteRejects) n++;
  }
  return n;
}

export type ConsolidationReport = {
  active: number;
  decayed: number;
  quarantined: number;
  merged: number;
  conflicts: number;
  health: number;
};

export const runConsolidation = singleFlight(consolidate);

async function consolidate(): Promise<ConsolidationReport> {
  const now = new Date();
  const active = db
    .select()
    .from(schema.preferences)
    .where(eq(schema.preferences.status, "active"))
    .orderBy(desc(schema.preferences.id))
    .all();

  const setStatus = (id: number, status: string) =>
    db.update(schema.preferences).set({ status }).where(eq(schema.preferences.id, id)).run();
  const reinforce = (id: number) =>
    db.update(schema.preferences).set({ reinforcedAt: now }).where(eq(schema.preferences.id, id)).run();

  // 1. Dedup + reinforce: keep the newest of each fingerprint; retiring a
  //    duplicate is a reinforcement signal for the survivor (it recurred).
  let merged = 0;
  const seen = new Map<string, Pref>(); // fingerprint → survivor (newest, seen first)
  for (const p of active) {
    const fp = fingerprint(p.note);
    const survivor = seen.get(fp);
    if (survivor) {
      setStatus(p.id, "decayed");
      reinforce(survivor.id);
      merged++;
    } else {
      seen.set(fp, p);
    }
  }
  const survivors = [...seen.values()];

  // 2. Quarantine likely poisoning: a low-trust note whose only provenance is a
  //    single source AND which the user's own golden cases contradict. Isolated,
  //    not deleted — kept for audit.
  let quarantined = 0;
  for (const p of survivors) {
    if (p.trust === "user") continue; // the user's own words are never quarantined
    if (contradictions(p.note) >= QUARANTINE_MIN_CONTRA) {
      setStatus(p.id, "quarantined");
      quarantined++;
    }
  }

  // 3. Decay stale, low-trust memory that hasn't been reinforced. User-authored
  //    memory persists regardless of age.
  let decayed = merged;
  const cutoff = now.getTime() - DECAY_DAYS * DAY_MS;
  for (const p of survivors) {
    if (p.trust === "user") continue;
    const still = db.select().from(schema.preferences).where(eq(schema.preferences.id, p.id)).get();
    if (!still || still.status !== "active") continue; // already quarantined above
    if (still.reinforcedAt.getTime() < cutoff) {
      setStatus(p.id, "decayed");
      decayed++;
    }
  }

  // 4. Conflict detection (recorded, not auto-resolved): opposite directives on
  //    the same target still active after the passes above. Surfaced so the
  //    next reflection can reconcile them.
  const remaining = db
    .select()
    .from(schema.preferences)
    .where(eq(schema.preferences.status, "active"))
    .all();
  let conflicts = 0;
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const a = remaining[i].note.toLowerCase();
      const b = remaining[j].note.toLowerCase();
      const aNeg = /do not|don't/.test(a);
      const bNeg = /do not|don't/.test(b);
      // Same learnedFrom-target-ish text, opposite polarity.
      if (aNeg !== bNeg && overlap(a, b)) conflicts++;
    }
  }

  // 5. Health score: penalize quarantines (poisoning signal) and conflicts,
  //    reward a lean active set. A visible trend line for memory quality.
  const activeCount = remaining.length;
  const health = Math.max(
    0,
    Math.min(
      100,
      100 - quarantined * 20 - conflicts * 10 - Math.max(0, activeCount - 30),
    ),
  );

  const note =
    quarantined > 0
      ? `Quarantined ${quarantined} likely-poisoned note(s).`
      : conflicts > 0
        ? `${conflicts} conflicting rule(s) flagged for reflection.`
        : merged > 0
          ? `Merged ${merged} duplicate(s); memory is coherent.`
          : "Memory is clean.";

  db.insert(schema.memoryAudits)
    .values({
      active: activeCount,
      decayed,
      quarantined,
      merged,
      conflicts,
      health,
      note,
      ranAt: now,
    })
    .run();

  return { active: activeCount, decayed, quarantined, merged, conflicts, health };
}

// Rough content overlap: do the two notes share a distinctive token (a sender
// address or a quoted phrase)? Keeps conflict detection from firing on generic
// notes while catching opposite directives about the same thing.
function overlap(a: string, b: string): boolean {
  const distinctive = (s: string) =>
    new Set((s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+|"[^"]+"/g) ?? []).map((t) => t));
  const da = distinctive(a);
  for (const t of distinctive(b)) if (da.has(t)) return true;
  return false;
}

export function latestMemoryAudit() {
  return db
    .select()
    .from(schema.memoryAudits)
    .orderBy(desc(schema.memoryAudits.id))
    .limit(1)
    .get();
}

export function quarantinedCount(): number {
  return db
    .select({ id: schema.preferences.id })
    .from(schema.preferences)
    .where(
      and(
        eq(schema.preferences.status, "quarantined"),
        ne(schema.preferences.status, "active"),
      ),
    )
    .all().length;
}

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Connected accounts. In the sandbox there is a single "fixtures" source;
// at home this holds Gmail/Calendar OAuth tokens and sync cursors.
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // 'gmail' | 'gcal' | 'fixtures'
  label: text("label").notNull(),
  credentials: text("credentials"), // OAuth tokens as plaintext JSON (protected by file perms — see SECURITY.md); null in sandbox
  syncCursor: text("sync_cursor"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// The normalized stream everything is triaged from.
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull(),
  externalId: text("external_id").notNull().unique(),
  kind: text("kind").notNull(), // 'email' | 'event'
  title: text("title").notNull(),
  from: text("from_addr"),
  bodySnippet: text("body_snippet"),
  occursAt: integer("occurs_at", { mode: "timestamp" }),
  // Sender authentication (DMARC pass). null = unknown. Auto-execution
  // requires this to be true — trust must key on a verified sender, not the
  // spoofable From header. See SECURITY.md (branch steering / spoofed trust).
  authenticated: integer("authenticated", { mode: "boolean" }),
  status: text("status").notNull().default("new"), // 'new' | 'triaged'
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// One row per triaged item: what Argus concluded and what you did about it.
export const decisions = sqliteTable("decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull(),
  verdict: text("verdict").notNull(), // 'needs_you' | 'handle' | 'ignore'
  action: text("action").notNull(), // 'none' | 'archive' | 'label' | 'draft_reply' | 'accept_event' | 'decline_event' | 'flag'
  actionParams: text("action_params"), // JSON
  reason: text("reason").notNull(),
  confidence: text("confidence").notNull(), // 'low' | 'medium' | 'high'
  dimension: text("dimension").notNull().default("other"), // 'wealth' | 'health' | 'happiness' | 'relationships' | 'home' | 'work' | 'other'
  engine: text("engine").notNull(), // 'claude-opus-4-8' | 'mock'
  userResponse: text("user_response"), // null | 'approved' | 'rejected' | 'acknowledged'
  respondedAt: integer("responded_at", { mode: "timestamp" }),
  autoRuleId: integer("auto_rule_id"), // set when a promoted experiment auto-approved this
  briefId: integer("brief_id"), // which brief run produced this decision
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Executed side effects, kept separate from decisions for auditability/undo.
export const actions = sqliteTable("actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  decisionId: integer("decision_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload"), // JSON
  result: text("result"),
  executedAt: integer("executed_at", { mode: "timestamp" }).notNull(),
  reversedAt: integer("reversed_at", { mode: "timestamp" }),
});

// Learned context injected into every triage prompt (the flywheel). Each note
// carries a trust level and a lifecycle status so the consolidation loop can
// decay, dedup, and quarantine memory — defense against silent poisoning
// (OWASP ASI06: Memory & Context Poisoning).
export const preferences = sqliteTable("preferences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note").notNull(),
  learnedFrom: text("learned_from"), // provenance, e.g. 'decision:42'
  trust: text("trust").notNull().default("inferred"), // 'user' | 'inferred' | 'untrusted'
  status: text("status").notNull().default("active"), // 'active' | 'decayed' | 'quarantined'
  reinforcedAt: integer("reinforced_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// One row per consolidation run — a visible record of memory health over time,
// so drift or poisoning shows up as a trend, not a surprise.
export const memoryAudits = sqliteTable("memory_audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  active: integer("active").notNull(),
  decayed: integer("decayed").notNull(),
  quarantined: integer("quarantined").notNull(),
  merged: integer("merged").notNull(),
  conflicts: integer("conflicts").notNull(),
  health: integer("health").notNull(), // 0-100
  note: text("note").notNull(),
  ranAt: integer("ran_at", { mode: "timestamp" }).notNull(),
});

// One row per brief run — makes "today" a first-class concept and gives the
// scheduler somewhere to record success/failure for the dashboard.
export const briefs = sqliteTable("briefs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger").notNull(), // 'manual' | 'schedule'
  status: text("status").notNull().default("running"), // 'running' | 'ok' | 'error'
  error: text("error"),
  synced: integer("synced").notNull().default(0),
  triaged: integer("triaged").notNull().default(0),
  auto: integer("auto").notNull().default(0),
  engine: text("engine"),
  ranAt: integer("ran_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

// Loop 1 — shadow experiments: automation candidates scored against the
// user's real decisions before they're ever allowed to act.
// shadow → proposed (evidence threshold met) → promoted (user approved) → retired
export const experiments = sqliteTable("experiments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matcherFrom: text("matcher_from").notNull(), // exact sender/organizer match
  predictedAction: text("predicted_action").notNull(),
  hits: integer("hits").notNull().default(0),
  agreements: integer("agreements").notNull().default(0),
  status: text("status").notNull().default("shadow"), // 'shadow' | 'proposed' | 'promoted' | 'retired'
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  promotedAt: integer("promoted_at", { mode: "timestamp" }),
});

// Loop 2 — the constitution: a versioned, Argus-maintained distillation of
// how the user wants their life run. The active row is injected into triage.
export const constitution = sqliteTable("constitution", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  content: text("content").notNull(),
  rationale: text("rationale").notNull(),
  evalScore: integer("eval_score"), // 0-100, score against the golden set at adoption
  status: text("status").notNull().default("active"), // 'active' | 'superseded' | 'rejected'
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Horizons — the proactive, life-expanding half of Argus. Where triage clears
// what you don't want to attend to, horizons lift your gaze: concrete
// experiences (hobbies, trips, people to reconnect with) proposed from the
// actual shape of your life — starved dimensions, engagement signals, and the
// empty space on your calendar. Suggestions only; Argus never books or spends.
export const horizons = sqliteTable("horizons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(), // 'hobby' | 'travel' | 'people' | 'local' | 'learning'
  title: text("title").notNull(),
  rationale: text("rationale").notNull(), // why you, why now — cites the evidence
  firstStep: text("first_step").notNull(), // one concrete action the user takes
  dimension: text("dimension").notNull(), // happiness | relationships | health | ...
  effort: text("effort").notNull(), // 'small' | 'medium' | 'big'
  timing: text("timing"), // "this Saturday" / "the long weekend of Jul 4"
  status: text("status").notNull().default("open"), // 'open' | 'saved' | 'dismissed' | 'snoozed'
  engine: text("engine").notNull(),
  respondedAt: integer("responded_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Loop 3 — golden set: every user response becomes a labeled test case that
// gates future changes to the triage prompt/constitution.
export const goldenCases = sqliteTable("golden_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemJson: text("item_json").notNull(), // snapshot: {kind,title,from,snippet}
  kind: text("kind").notNull(), // 'positive' (user approved action) | 'negative' (user rejected action)
  action: text("action").notNull(),
  decisionId: integer("decision_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

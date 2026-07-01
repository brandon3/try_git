import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Connected accounts. In the sandbox there is a single "fixtures" source;
// at home this holds Gmail/Calendar OAuth tokens and sync cursors.
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // 'gmail' | 'gcal' | 'fixtures'
  label: text("label").notNull(),
  credentials: text("credentials"), // encrypted JSON at home; null in sandbox
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
  userResponse: text("user_response"), // null | 'approved' | 'rejected'
  respondedAt: integer("responded_at", { mode: "timestamp" }),
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

// Learned context injected into every triage prompt (the flywheel).
export const preferences = sqliteTable("preferences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note").notNull(),
  learnedFrom: text("learned_from"), // e.g. 'decision:42'
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

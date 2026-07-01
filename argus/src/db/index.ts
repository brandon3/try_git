import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(process.env.ARGUS_DB ?? "argus.db");
sqlite.pragma("journal_mode = WAL");

// Bootstrap DDL at startup — a personal tool doesn't need a migration
// framework yet; when the schema stabilizes, switch to drizzle-kit.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  credentials TEXT,
  sync_cursor TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  from_addr TEXT,
  body_snippet TEXT,
  occurs_at INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  action TEXT NOT NULL,
  action_params TEXT,
  reason TEXT NOT NULL,
  confidence TEXT NOT NULL,
  engine TEXT NOT NULL,
  user_response TEXT,
  responded_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  result TEXT,
  executed_at INTEGER NOT NULL,
  reversed_at INTEGER
);
CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL,
  learned_from TEXT,
  created_at INTEGER NOT NULL
);
`);

// Additive column migrations for existing databases.
const decisionCols = sqlite.prepare("PRAGMA table_info(decisions)").all() as { name: string }[];
if (!decisionCols.some((c) => c.name === "dimension")) {
  sqlite.exec("ALTER TABLE decisions ADD COLUMN dimension TEXT NOT NULL DEFAULT 'other'");
}

export const db = drizzle(sqlite, { schema });
export { schema };

#!/usr/bin/env node
// Nightly SQLite backup using the online-backup API — safe while Argus is
// running (a plain `cp` of a WAL-mode database is not).
//
//   node deploy/backup.mjs /var/lib/argus/argus.db /var/lib/argus/backups
//
// Cron (as the argus user):  15 4 * * *  node /var/lib/argus/app/argus/deploy/backup.mjs \
//     /var/lib/argus/argus.db /var/lib/argus/backups
//
// Keeps the last 14 backups. Point the destination at a second disk or a
// synced folder (Syncthing/Drive) for off-machine copies.

import Database from "better-sqlite3";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const [src = "argus.db", destDir = "./backups"] = process.argv.slice(2);
const KEEP = 14;

mkdirSync(destDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const dest = join(destDir, `argus-${stamp}.db`);

const db = new Database(src, { readonly: true });
await db.backup(dest);
db.close();
console.log(`backed up ${src} → ${dest}`);

const old = readdirSync(destDir)
  .filter((f) => /^argus-\d{4}-\d{2}-\d{2}\.db$/.test(f))
  .sort()
  .slice(0, -KEEP);
for (const f of old) {
  unlinkSync(join(destDir, f));
  console.log(`pruned ${f}`);
}

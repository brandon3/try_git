// Pre-deploy doctor. Run before the first real 7am brief so you aren't
// debugging config at 7am:
//
//   npm run doctor           # offline: validate config, DB, timezone
//   npm run doctor -- --live # also ping Anthropic + refresh Google tokens
//
// Prints a checklist and a GO / NO-GO verdict, and exits non-zero if any
// hard requirement fails — so it can gate a systemd ExecStartPre if you want.
//
// Deliberately dependency-light and defensive: it pre-checks the DB directory
// before importing the DB layer, so a bad ARGUS_DB path reports as a clean
// failure line rather than a stack trace.

import { existsSync, accessSync, constants, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Status = "ok" | "warn" | "fail";
type Check = { status: Status; label: string; detail: string };

const checks: Check[] = [];
const add = (status: Status, label: string, detail: string) =>
  checks.push({ status, label, detail });

const live = process.argv.includes("--live");

// ── Node runtime ─────────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 18) {
  add("fail", "Node runtime", `Node ${process.versions.node} — Argus needs ≥18 (better-sqlite3 ABI). Upgrade.`);
} else if (nodeMajor !== 22) {
  add("warn", "Node runtime", `Node ${process.versions.node} — deploy docs pin Node 22; run \`npm ci\` after any Node change so better-sqlite3 rebuilds.`);
} else {
  add("ok", "Node runtime", `Node ${process.versions.node}`);
}

// ── Decision engine (Anthropic) ──────────────────────────────────────
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) {
  add("warn", "ANTHROPIC_API_KEY", "unset — Argus will run the deterministic MOCK engine, not Claude. Set it for real triage.");
} else if (!anthropicKey.startsWith("sk-ant-")) {
  add("warn", "ANTHROPIC_API_KEY", "set but doesn't look like an Anthropic key (expected sk-ant-…). Double-check it.");
} else {
  add("ok", "ANTHROPIC_API_KEY", `set (…${anthropicKey.slice(-4)})`);
}
const triageModel = process.env.ARGUS_TRIAGE_MODEL;
if (triageModel && triageModel !== "claude-opus-4-8") {
  add("warn", "ARGUS_TRIAGE_MODEL", `overridden to "${triageModel}" — benchmark it against your golden set (GET /api/stats) before trusting it.`);
}

// ── Google OAuth ─────────────────────────────────────────────────────
const gId = process.env.GOOGLE_CLIENT_ID;
const gSecret = process.env.GOOGLE_CLIENT_SECRET;
const gRedirect = process.env.GOOGLE_REDIRECT_URI;
if (!gId || !gSecret) {
  add("warn", "Google OAuth", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET unset — Gmail & Calendar won't connect; fixtures will stand in.");
} else {
  add("ok", "Google credentials", "client id + secret set");
  if (!gRedirect) {
    add("warn", "GOOGLE_REDIRECT_URI", "unset — defaults to http://localhost:3000/api/auth/callback, which won't match a home-server host. Set it explicitly.");
  } else if (!gRedirect.endsWith("/api/auth/callback")) {
    add("fail", "GOOGLE_REDIRECT_URI", `"${gRedirect}" must end with /api/auth/callback and match the Google console byte-for-byte, or consent fails.`);
  } else if (!/^https?:\/\//.test(gRedirect)) {
    add("fail", "GOOGLE_REDIRECT_URI", `"${gRedirect}" must start with http:// or https://.`);
  } else {
    add("ok", "GOOGLE_REDIRECT_URI", gRedirect);
  }
}

// ── Single-user auth secret ──────────────────────────────────────────
const secret = process.env.ARGUS_SECRET;
if (!secret) {
  add("warn", "ARGUS_SECRET", "unset — every request is UNAUTHENTICATED. Only safe behind Tailscale on a trusted LAN. Set it: `openssl rand -hex 24`.");
} else if (secret.length < 24) {
  add("warn", "ARGUS_SECRET", `only ${secret.length} chars — use a longer secret (\`openssl rand -hex 24\` = 48 chars).`);
} else {
  add("ok", "ARGUS_SECRET", `set (${secret.length} chars)`);
}

// ── Timezone ─────────────────────────────────────────────────────────
const tz = process.env.ARGUS_TZ;
if (!tz) {
  add("warn", "ARGUS_TZ", "unset — the scheduler uses the system timezone, which systemd may not inherit. Set it so the 7am brief fires at 7am local.");
} else {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    add("ok", "ARGUS_TZ", tz);
  } catch {
    add("fail", "ARGUS_TZ", `"${tz}" is not a valid IANA timezone (e.g. America/Los_Angeles). The scheduler will throw.`);
  }
}

// ── Scheduler cron expressions ───────────────────────────────────────
if (process.env.ARGUS_CRON === "0") {
  add("warn", "Scheduler", "ARGUS_CRON=0 — scheduling is DISABLED. No automatic 7am brief; run it manually or from the dashboard.");
}

// ── Database path + directory writability ────────────────────────────
const dbPath = process.env.ARGUS_DB ?? "argus.db";
if (dbPath === ":memory:") {
  add("warn", "Database", ":memory: — nothing persists across restarts. Point ARGUS_DB at a file on disk for a real deploy.");
} else {
  const absDb = resolve(dbPath);
  const dir = dirname(absDb);
  if (!existsSync(dir)) {
    add("fail", "Database directory", `${dir} does not exist — create it (owned by the argus user) before starting.`);
  } else {
    try {
      accessSync(dir, constants.W_OK);
      if (existsSync(absDb)) {
        try {
          accessSync(absDb, constants.W_OK);
          add("ok", "Database", `${absDb} (exists, writable)`);
        } catch {
          add("fail", "Database", `${absDb} exists but is not writable by this user.`);
        }
      } else {
        add("ok", "Database", `${absDb} (will be created in a writable directory)`);
      }
    } catch {
      add("fail", "Database directory", `${dir} is not writable by this user (${process.getuid?.() ?? "?"}). systemd runs Argus as the argus user — chown it.`);
    }
  }
}

// ── DB opens + migrates cleanly (dynamic import so failures are caught) ─
async function checkDbOpens() {
  if (dbPath !== ":memory:" && checks.some((c) => c.status === "fail" && c.label.startsWith("Database"))) {
    return; // already reported; importing would just crash
  }
  try {
    const { db, schema } = await import("@/db");
    // A trivial read proves the bootstrap DDL + additive migrations ran.
    db.select({ id: schema.briefs.id }).from(schema.briefs).limit(1).all();
    add("ok", "Schema", "bootstrap DDL + additive migrations applied cleanly");
  } catch (err) {
    add("fail", "Schema", `DB failed to open or migrate: ${(err as Error).message}`);
  }
}

// ── Live: Anthropic reachability ─────────────────────────────────────
async function checkAnthropicLive() {
  if (!anthropicKey) return;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const model = triageModel ?? "claude-opus-4-8";
    const m = await client.models.retrieve(model);
    add("ok", "Anthropic (live)", `authenticated; model ${m.id} reachable`);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 401) add("fail", "Anthropic (live)", "401 — ANTHROPIC_API_KEY is invalid or revoked.");
    else if (e.status === 404) add("fail", "Anthropic (live)", `model not found — ${triageModel ?? "claude-opus-4-8"} isn't available to this key.`);
    else add("warn", "Anthropic (live)", `could not verify: ${e.message ?? "network error"} (check outbound network / proxy).`);
  }
}

// ── Live: Google token refresh ───────────────────────────────────────
async function checkGoogleLive() {
  if (!gId || !gSecret) return;
  try {
    const { db, schema } = await import("@/db");
    const { oauthClient } = await import("@/connectors/google");
    const sources = db.select().from(schema.sources).all().filter((s) => s.credentials);
    if (sources.length === 0) {
      add("warn", "Google (live)", "no stored tokens yet — visit /api/auth/google once to connect.");
      return;
    }
    for (const s of sources) {
      try {
        const client = oauthClient();
        client.setCredentials(JSON.parse(s.credentials!));
        const at = await client.getAccessToken(); // refreshes if expired
        if (at?.token) add("ok", `Google (live) — ${s.label}`, "token valid / refreshable");
        else add("fail", `Google (live) — ${s.label}`, "no access token returned — reconnect via /api/auth/google.");
      } catch (err) {
        add("fail", `Google (live) — ${s.label}`, `refresh failed: ${(err as Error).message} — reconnect (consent screen must be 'In production').`);
      }
    }
  } catch (err) {
    add("warn", "Google (live)", `could not verify: ${(err as Error).message}`);
  }
}

// ── Run + report ─────────────────────────────────────────────────────
async function main() {
  await checkDbOpens();
  if (live) {
    await checkAnthropicLive();
    await checkGoogleLive();
  }

  const glyph = { ok: "✓", warn: "⚠", fail: "✗" } as const;
  const pad = Math.max(...checks.map((c) => c.label.length));
  console.log(`\n  Argus doctor — ${live ? "live" : "offline"} check\n`);
  for (const c of checks) {
    console.log(`  ${glyph[c.status]}  ${c.label.padEnd(pad)}  ${c.detail}`);
  }

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  console.log("");
  if (fails > 0) {
    console.log(`  NOT READY — ${fails} blocking issue${fails === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}. Fix the ✗ lines above.\n`);
    if (!live) console.log("  Tip: run `npm run doctor -- --live` to also verify Anthropic + Google connectivity.\n");
    process.exit(1);
  }
  console.log(`  READY${warns > 0 ? ` — with ${warns} warning${warns === 1 ? "" : "s"} (review the ⚠ lines)` : ""}.`);
  if (!live) console.log("  Run `npm run doctor -- --live` to also verify Anthropic + Google connectivity.");
  console.log("");
  process.exit(0);
}

void main();

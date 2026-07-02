# Argus ◉

Personal AI chief of staff — it watches your inbox and calendar so you don't
have to. See [`../GAMEPLAN.md`](../GAMEPLAN.md) for the full plan.

## Try it (sandbox mode)

```sh
npm ci
npm run build && npm start     # or: npm run dev
npm test                       # loop-math regression suite
```

With no configuration, fixture emails/events stand in for Gmail/Calendar and
a deterministic mock stands in for Claude. Everything else — schema, approval
flow, executor, scheduler, the four learning loops — is the real code, and the
dashboard banners tell you exactly which real pieces aren't wired up yet.

## Deploy on the home server

1. **Clone and build**
   ```sh
   sudo useradd -r -m -d /var/lib/argus argus
   sudo -u argus git clone <this-repo> /var/lib/argus/app
   cd /var/lib/argus/app/argus && sudo -u argus npm ci && sudo -u argus npm run build
   ```
2. **Configure** — `cp .env.example` values into a root-owned env file:
   ```sh
   sudo install -m 600 -o argus /dev/null /var/lib/argus/argus.env
   sudoedit /var/lib/argus/argus.env   # ANTHROPIC_API_KEY, GOOGLE_*, ARGUS_SECRET, ARGUS_TZ
   ```
3. **Google OAuth** (one time) — console.cloud.google.com:
   - New project → enable **Gmail API** + **Calendar API**
   - OAuth consent screen → publishing status **In production**
     (⚠️ *Testing* status expires refresh tokens every 7 days and will
     silently break Argus weekly; production shows a one-time
     "unverified app" warning — fine for personal use)
   - OAuth client (Web application) → redirect URI
     `http://<host>:3000/api/auth/callback` (must match `GOOGLE_REDIRECT_URI`
     byte-for-byte)
4. **Service**
   ```sh
   sudo cp deploy/argus.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now argus
   journalctl -u argus -f    # expect: "[argus] scheduler up — brief …"
   ```
5. **First login** — from a browser on your network (or Tailscale):
   visit `http://<host>:3000/?key=<ARGUS_SECRET>` (sets a cookie), then
   tap **Connect Gmail & Calendar** on the banner and grant access.
6. **Backups** — cron as the argus user:
   ```
   15 4 * * * node /var/lib/argus/app/argus/deploy/backup.mjs /var/lib/argus/argus.db /var/lib/argus/backups
   ```
7. **Access from your phone** — join the machine to Tailscale and open
   `http://<tailscale-name>:3000`. Don't port-forward Argus to the internet.

The scheduler runs the brief at **7:00** and reflection at **3:30** in
`ARGUS_TZ` (override with `ARGUS_BRIEF_CRON` / `ARGUS_REFLECT_CRON`).

## War game — what will go wrong, and what already handles it

| Speed bump | What you'll see | Mitigation |
|---|---|---|
| OAuth consent left in *Testing* | Works for a week, then empty briefs | Docs + code comments insist on **In production**; disconnect shows the "Connect Google" banner |
| Redirect URI mismatch | Google error page at consent | URI in `.env.example` and README marked must-match-byte-for-byte |
| Refresh token revoked (password change, security event) | Sync returns nothing | `googleConnected` check → dashboard banner with reconnect link |
| `ANTHROPIC_API_KEY` missing/typo'd | Decisions look dumb | Mock engine banner on the dashboard — mock is never silent |
| Anthropic API error during the 7am run | Cron "fails silently" | Every run recorded in `briefs` (status + error); red banner on the dashboard; journalctl log |
| Cron fires in the wrong timezone | 7am brief at 3pm | `TZ`/`ARGUS_TZ` explicit in the unit file and env; scheduler logs its config at boot |
| Overlapping runs (cron + button) | Duplicate decisions | Coalescing lock in `runBrief` (tested) |
| Double-tap / stale tab approvals | Action executes twice | One-response-per-decision guard, 409 on replay (tested) |
| Gmail API hiccup mid-approve | "Done" but nothing happened | Execute-before-commit: claim released on failure, card returns to pending, error surfaced |
| Auto-rule archives something important | Trust destroyed | Only reversible actions auto-execute; **Undo** on every executed card; undo demotes the rule |
| WAL-mode DB corrupted by naive `cp` backup | Restore fails | `deploy/backup.mjs` uses SQLite's online-backup API |
| Node version mismatch breaks better-sqlite3 | `ERR_DLOPEN_FAILED` at boot | Pin Node 22 (`.nvmrc`-style note); `npm ci` after every Node upgrade |
| Someone on the LAN finds the port | They run your life | `ARGUS_SECRET` middleware (Bearer or cookie) + Tailscale-only exposure |
| Prompt injection via email content | Malicious mail steers triage | Fixed action enum, approval gate, auto-rules limited to reversible actions on *earned* senders |
| systemd unit can't find the DB | Empty app after reboot | `ARGUS_DB` absolute path in the unit; `WorkingDirectory` set |

## Self-improvement loops

Argus learns from every tap, but **nothing self-promotes**:

- **Shadow experiments** — repeated identical approvals spawn a hidden
  predictor; at 3/3+ agreement it appears in your brief as "Promote?".
  Promoted rules auto-run reversible actions only and demote themselves if
  their agreement rate decays — an **Undo** counts as a disagreement.
- **Reflection** (3:30am, or the dashboard button) — distills your responses
  into a versioned constitution injected into triage.
- **Golden-set evals** — your responses are the regression suite gating every
  constitution rewrite. Also your model benchmark: set
  `ARGUS_TRIAGE_MODEL=claude-sonnet-5`, run the evals, compare.
- **Calibration** — measured accuracy per confidence bucket (manual responses
  only), fed back into the prompt. `GET /api/stats` shows everything.

## Layout

```
src/db/            schema + SQLite bootstrap (additive migrations)
src/connectors/    fixtures (sandbox) · google/gmail/gcal (real)
src/engine/        triage (pure core) · brief · executor · experiments ·
                   evals · calibration · reflect
src/engine/__tests__/  loop-math regression suite (vitest)
src/server/        cron scheduler (started from instrumentation.ts)
src/app/           dashboard + API routes; middleware.ts = auth
deploy/            systemd unit · online-backup script
```

## Safety model

- The model proposes actions from a fixed enum only; `send`/`delete` aren't in it.
- Approval is enforced in the executor, not the prompt; one response per
  decision, ever (409 on replay).
- Autonomy is only granted where undo exists, and only to senders that
  earned it through the shadow-experiment loop.
- Drafts are drafts — sending is always a human act.
- Every side effect is recorded in `actions`; every constitution rewrite is a
  kept, scored version.

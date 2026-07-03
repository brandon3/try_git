# Argus — Personal AI Chief of Staff

**Gameplan · July 2026**

A personal web app where AI runs the parts of your life you don't want to pay attention to — and lifts your gaze to the parts worth reaching for. Two gazes, one watchman: it ingests your inboxes and calendars, decides what matters, and shows you one dashboard (*here's what I handled, here's what needs you*); and it watches the quiet corners of your life to propose experiences that expand it (*here's what would be worth your time*).

**The persona:** Argus Panoptes, the hundred-eyed giant of Greek myth who never fully slept — some eyes always kept watch. That's the product in one image: it watches everything so you don't have to. The persona carries into the UI voice ("Argus has eyes on it", "Nothing needs you today") and the triage system prompt, which frames the model as a vigilant, understated steward — observant, brief, never dramatic.

**Deployment decision (settled):** runs on a home server — an always-on Node process with local SQLite and node-cron for the 7am brief. No cloud hosting; the Google OAuth app is published to “In production” status (testing status expires refresh tokens every 7 days) with you as the only real user.

---

## 1. Vision & core principles

**The pitch:** You open one page in the morning. It says: "12 emails archived, 2 need replies (drafts ready), your Thursday double-booking is resolved pending your OK, your car registration renews in 9 days." You tap approve twice and get on with your day.

**Principles that keep this from becoming a mess:**

1. **Trust ladder.** Every category of action has an autonomy level: `suggest` → `one-tap approve` → `fully automatic`. Everything starts at `suggest`. You promote categories only after the AI has proven itself ("it's recommended archiving these newsletters correctly 30 times — auto-archive from now on?").
2. **Reversible-by-default.** The AI only gets automatic control over actions that can be undone (archive, label, draft). Irreversible actions (send, delete, decline) always require a tap, forever, unless you explicitly override per-rule.
3. **Decisions are data.** Every recommendation and your response to it (approve / reject / edit) is stored and fed back as context. The system gets more *you* over time.
4. **One inbox to rule them all.** Internally, everything (email, event, reminder, bill) is normalized into a single `items` stream that the decision engine triages. New sources plug in without new UI.
5. **Life dimensions.** Every item is tagged with the part of life it touches: **wealth · health · happiness · relationships · home** (plus work and other as catch-alls). Verdict says *how urgent*; dimension says *which life area*. Today that's a filterable tag on the dashboard. The long game: each dimension becomes a coverage area with its own sources and proactive watchers —
   - **Wealth**: bills, renewals, price hikes, statements; later a subscription ledger and monthly burn report.
   - **Health**: appointments, prescriptions, renewals; later "you haven't scheduled a physical this year."
   - **Happiness**: presales, hobbies, trips; later "you have zero fun on the calendar for three weeks."
   - **Relationships**: birthdays, neglected threads; later "you haven't talked to Mom in a month."
   - **Home**: maintenance cadences, vehicle admin; later a recurring-maintenance schedule Argus manages itself.
   The dimension tags collected now are the training data for those watchers.

---

## 2. Scope

### MVP (Phase 1) — "The Daily Brief"

- Connect Gmail + Google Calendar (OAuth, your account only — single-user app).
- On demand + every morning at 7am: pull new email and the next 7 days of calendar.
- Claude triages everything into: **Needs you** / **Handled (proposed)** / **Ignore**, with a recommended action and one-line reason for each.
- Dashboard shows the brief; each proposed action is one-tap approve (archive, label, draft reply, accept/decline event).
- Approve executes via the Gmail/Calendar APIs. Every decision is logged.

### Explicitly out of scope for MVP

Auto-send anything, bank/finance integration, multi-user, mobile app, non-Google sources. These come later or never — see roadmap.

---

## 3. Architecture & stack

```
┌─────────────────────────────────────────────────┐
│  Next.js (App Router, TypeScript)                │
│  ├─ /            Dashboard (daily brief, queue)  │
│  ├─ /history     Decision log & stats            │
│  ├─ /settings    Autonomy levels, rules, sources │
│  └─ /api/*       Route handlers                  │
├─────────────────────────────────────────────────┤
│  Decision engine (Claude API via @anthropic-ai/sdk) │
│  Connectors: Gmail API · Google Calendar API     │
│  Jobs: node-cron (morning brief, refresh)        │
├─────────────────────────────────────────────────┤
│  SQLite via Drizzle ORM (single file, easy backup)│
└─────────────────────────────────────────────────┘
```

**Stack choices and why:**

| Choice | Why |
|---|---|
| **Next.js + TypeScript** | One codebase for UI + API routes; huge ecosystem; easy to deploy anywhere later. |
| **SQLite + Drizzle** | Single-user personal tool — no reason to run a DB server. One file, trivially backed up. Drizzle for typed queries + migrations. |
| **`@anthropic-ai/sdk`** | The decision engine. Tool use + structured outputs do the heavy lifting (details in §5). |
| **Google APIs (`googleapis`)** | OAuth 2.0 with offline refresh token, stored encrypted. Consent screen published to “In production” — testing status expires refresh tokens after 7 days and would break Argus weekly; the one-time unverified-app warning is fine for personal use. |
| **node-cron on the home server** | An always-on Node process at home runs the 7am brief and syncs. Keeps tokens and email data entirely on your own hardware — no cloud host to trust. |
| **Tailwind + shadcn/ui** | Fast, clean dashboard UI without design overhead. |

## 4. Data model

```
sources      — connected accounts (gmail, gcal), tokens, sync cursors
items        — the normalized stream: (source, external_id, kind, title,
               body_snippet, occurs_at, raw_ref, status)
decisions    — one per triaged item: (item_id, verdict, proposed_action,
               reason, confidence, user_response, responded_at)
actions      — executed side effects: (decision_id, type, payload, result,
               executed_at, reversed_at?)
rules        — promoted automations: (matcher, action, autonomy_level,
               created_from_decision_ids, hit_count)
briefs       — morning brief snapshots for the dashboard/history
preferences  — freeform learned context ("user never attends optional
               standups", "newsletters from X are read, not junk")
```

The `decisions.user_response` column is the flywheel: recent approvals/rejections get summarized into `preferences`, which is injected into every future triage prompt.

---

## 5. AI design (the interesting part)

### Model

**`claude-opus-4-8`** for the triage/decision engine ($5 in / $25 out per MTok, 1M context). Decision quality is the entire product — a wrong "safe to ignore" costs you a missed flight. Adaptive thinking (`thinking: {type: "adaptive"}`) with `output_config: {effort: "medium"}` for routine triage, `high` for the morning brief synthesis.

If cost becomes annoying, the levers in order: prompt caching (below), Batch API (below), and only then dropping non-critical classification (e.g. "is this a newsletter?") to `claude-haiku-4-5` ($1/$5). Don't start there — start smart, optimize later with real usage data.

### Triage call shape

One `messages.parse()` call per batch of new items, with a Zod schema (`zodOutputFormat`) so output is guaranteed-valid JSON:

```ts
const Triage = z.object({
  itemId: z.string(),
  verdict: z.enum(["needs_you", "handle", "ignore"]),
  action: z.enum(["none", "archive", "label", "draft_reply",
                  "accept_event", "decline_event", "flag"]),
  actionParams: z.record(z.string()).optional(),
  reason: z.string(),          // one line, shown in UI
  confidence: z.enum(["low", "medium", "high"]),
});
```

Structured outputs mean the executor never parses prose — it maps `action` straight to a Gmail/Calendar API call behind the approval gate.

### Prompt caching

The system prompt (persona + triage policy + the `preferences` summary) is large and stable → `cache_control: {type: "ephemeral"}` breakpoint after it. Per-run items go after the breakpoint. Keep the system prompt byte-stable (no timestamps in it — current date goes in the user turn) so cache reads (~0.1× price) actually hit.

### Batch API for the morning brief

The 7am run isn't latency-sensitive → use the Message Batches API (50% off all tokens). Kick the batch at ~6:30, poll, assemble the brief by 7. Interactive re-triage during the day uses regular streaming calls.

### Safety rails

- The model only ever *proposes* `action` values from a fixed enum — it cannot invent side effects.
- The executor enforces the trust ladder independently of what the model says: an action runs automatically only if a matching `rules` row is at `auto` level. The model doesn't know or control autonomy levels.
- Irreversible actions (`send`, `delete`) aren't even in the enum for v1.

---

## 6. Roadmap

### Phase 1 — Daily Brief (MVP) · BUILT (sandbox)
- [x] Scaffold Next.js + Drizzle + SQLite; home-server deploy kit (`argus/deploy/`: systemd unit, online-backup script, `.env.example`)
- [x] Google OAuth flow, token storage, Gmail + Calendar sync into `items` (fixtures stand in until first home run)
- [x] Triage engine (pure core + Claude/mock), decision log, day-scoped briefs with carryover
- [x] Dashboard: brief view, approve/reject/acknowledge, batch approve, undo, executor for archive/label/draft/accept/decline
- [x] 7am cron + 3:30am reflection via node-cron (timezone-explicit); every run recorded and surfaced on failure
- [x] Single-user auth (ARGUS_SECRET), health banners, loop-math test suite (11 tests)
- **Done when:** you use it instead of opening Gmail first, three mornings in a row.

### Phase 2 — The self-improvement loops · BUILT (sandbox)
Four recursive loops, sharing one invariant: **nothing self-promotes** —
evidence accumulates silently, and crossing a threshold produces a proposal
in the brief, never an autonomous grant of autonomy.
- [x] **Shadow experiments** (trust ladder, done empirically): repeated identical
      approvals spawn an experiment that silently predicts your decisions; at
      3/3+ agreement it proposes itself ("Promote?"); promoted rules auto-execute
      reversible actions only (archive/label/flag), and demote themselves back to
      shadow if their agreement rate decays below 80%.
- [x] **Nightly reflection → constitution**: a second Claude pass distills your
      responses and notes into a versioned "constitution" injected into every
      triage. Every rewrite is gated by the golden set and kept as an auditable
      version — Argus edits its own instructions, never invisibly.
- [x] **Golden-set evals**: every approve/reject becomes a labeled test case;
      candidate constitutions are replayed against the set in shadow and adopted
      only if they don't regress past decisions. The system's mistakes police its
      future self-modifications.
- [x] **Calibration**: measured accuracy per confidence bucket (manual responses
      only — auto-approvals can't grade their own homework), fed back into the
      triage prompt once n≥5 per bucket.
- **Done when:** ≥50% of routine email is handled without a tap.

### Phase 3 — Proactive mode · partially BUILT
- [x] **Horizons — the life-expansion engine.** The other half of the thesis:
      triage clears what you don't want to attend to; Horizons lifts your gaze
      to what would enrich you. A weekly scan reads the *shape* of your life —
      which enriching dimensions (happiness/relationships/health) have gone
      quiet, what you've engaged with, and where your calendar is genuinely
      empty — and proposes 1–3 concrete, evidence-grounded experiences
      (hobbies, trips, people to reconnect with, local things, things to learn).
      Every suggestion cites *why you, why now*; the first step is always
      something you do; Argus never books or spends. Save/dismiss trains a
      taste profile for the next scan. Its own warm dashboard page + a teaser
      on the daily board.
- [ ] Conflict/deadline detection (double bookings, RSVP deadlines, "you haven't replied to X in 4 days")
- [ ] Notifications (email-to-self or ntfy.sh push) for "needs you now" items
- [ ] Midday delta briefs when something important lands
- **Done when:** it catches a real scheduling conflict before you do, *and* a
      Horizons suggestion actually gets you out doing something new.

### Phase 4 — More of your life (pick based on pain)
- Subscriptions & bills (parse receipts/renewal emails already in Gmail — no bank API needed)
- Errands/reminders source (Google Tasks or plain text inbox)
- Weekly "life review" report: time allocation, decision stats, what got automated
- Maybe: draft-and-send with a 5-minute undo window (first irreversible-ish action)

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| AI archives something important | Trust ladder + reversible-only actions + everything logged with one-tap undo. |
| OAuth token/scopes leak | Tokens encrypted at rest; app runs on your own box; minimal scopes (`gmail.modify`, `calendar.events`). |
| API costs creep | Caching + batch from day 1; per-day token budget logged on dashboard; hard monthly cap kills cron if exceeded. |
| Model refuses/errors mid-triage | Fixed action enum + retries; anything unparseable falls back to `needs_you` (fail toward human attention, never toward silence). |
| You stop trusting it after one bad call | Every action shows its `reason`; rejections immediately update `preferences`; per-category kill switch in settings. |
| Scope creep (the classic) | Phase gates above have "done when" criteria. No Phase 4 until Phase 2's automation rate is real. |

**Cost ballpark:** ~100 emails+events/day ≈ 150K input / 10K output tokens daily on Opus 4.8 ≈ **$15–25/month** before caching/batch, realistically **$8–15/month** after. Cheap for a chief of staff.

---

## 8. First session checklist

1. `npx create-next-app argus --typescript --tailwind`
2. Add Drizzle + SQLite, define the §4 schema, run first migration
3. Google Cloud project → OAuth client, consent screen published to “In production” (not testing — 7-day token expiry) → get Gmail+Calendar consent working. Set the redirect URI to the home server's address (e.g. `http://argus.local:3000/api/auth/callback` or a Tailscale hostname) — do the one-time consent from a browser on your network.
4. Hardcode one triage call against 10 real emails; eyeball the verdicts
5. If the verdicts feel right → build the dashboard. If not → tune the prompt first. The triage quality is the product; everything else is plumbing.

**Home-server notes:** run under `systemd` or `pm2` so it survives reboots; nightly `sqlite3 argus.db ".backup"` cron to a second disk or cloud drive; access from your phone via Tailscale rather than exposing a port to the internet.

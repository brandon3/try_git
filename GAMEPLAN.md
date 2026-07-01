# Autopilot — Personal AI Chief of Staff

**Gameplan · July 2026**

A personal web app where AI runs the parts of your life you don't want to pay attention to. It ingests your inboxes and calendars, decides what matters, recommends (and eventually takes) actions, and shows you one dashboard: *here's what I handled, here's what needs you.*

---

## 1. Vision & core principles

**The pitch:** You open one page in the morning. It says: "12 emails archived, 2 need replies (drafts ready), your Thursday double-booking is resolved pending your OK, your car registration renews in 9 days." You tap approve twice and get on with your day.

**Principles that keep this from becoming a mess:**

1. **Trust ladder.** Every category of action has an autonomy level: `suggest` → `one-tap approve` → `fully automatic`. Everything starts at `suggest`. You promote categories only after the AI has proven itself ("it's recommended archiving these newsletters correctly 30 times — auto-archive from now on?").
2. **Reversible-by-default.** The AI only gets automatic control over actions that can be undone (archive, label, draft). Irreversible actions (send, delete, decline) always require a tap, forever, unless you explicitly override per-rule.
3. **Decisions are data.** Every recommendation and your response to it (approve / reject / edit) is stored and fed back as context. The system gets more *you* over time.
4. **One inbox to rule them all.** Internally, everything (email, event, reminder, bill) is normalized into a single `items` stream that the decision engine triages. New sources plug in without new UI.

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
| **Google APIs (`googleapis`)** | OAuth 2.0 with offline refresh token, stored encrypted. "Testing" mode on the OAuth consent screen is fine — it's just you. |
| **node-cron in a long-running server** | Deploy as a plain Node server on a small VPS/home server/Fly.io machine so the 7am brief can run. (Vercel works too with Vercel Cron, but a persistent server is simpler for a personal tool with background jobs.) |
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

### Phase 1 — Daily Brief (MVP) · ~2 weekends
- [ ] Scaffold Next.js + Drizzle + SQLite; deploy target picked
- [ ] Google OAuth flow, token storage, Gmail + Calendar sync into `items`
- [ ] Triage engine (schema above), decision log
- [ ] Dashboard: brief view, approve/reject taps, executor for archive/label/draft/accept/decline
- [ ] 7am cron via Batch API
- **Done when:** you use it instead of opening Gmail first, three mornings in a row.

### Phase 2 — Memory & the trust ladder · ~1–2 weekends
- [ ] Feed decision history back: weekly job summarizes approvals/rejections into `preferences`
- [ ] Rule promotion UX: "you've approved this 10× — automate it?"
- [ ] Autonomy levels enforced in executor; settings page
- **Done when:** ≥50% of routine email is handled without a tap.

### Phase 3 — Proactive mode · ~2 weekends
- [ ] Conflict/deadline detection (double bookings, RSVP deadlines, "you haven't replied to X in 4 days")
- [ ] Notifications (email-to-self or ntfy.sh push) for "needs you now" items
- [ ] Midday delta briefs when something important lands
- **Done when:** it catches a real scheduling conflict before you do.

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

1. `npx create-next-app autopilot --typescript --tailwind`
2. Add Drizzle + SQLite, define the §4 schema, run first migration
3. Google Cloud project → OAuth client (testing mode) → get Gmail+Calendar consent working
4. Hardcode one triage call against 10 real emails; eyeball the verdicts
5. If the verdicts feel right → build the dashboard. If not → tune the prompt first. The triage quality is the product; everything else is plumbing.

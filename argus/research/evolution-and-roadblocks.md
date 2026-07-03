# Argus — future evolution, immediate roadblocks, creative solutions

*Research report, July 2026. Sourced from Google's OAuth/verification docs and
policy, the 2026 local-model and agent-architecture literature, and the current
AI-email product landscape. Citations at the end.*

---

## Part 1 — Immediate roadblocks (and how to get past each)

### Roadblock A — "Won't Gmail's restricted scope force me into a $$$ security audit?"

**No — not for a single-user app.** This is the one that scares people off, and
it does not apply to you.

- `gmail.modify` (read/label/archive/draft, **no permanent delete**) is a
  sensitive/restricted scope, so commercial apps that ship it to the public
  must pass **CASA** (Cloud Application Security Assessment) — a paid,
  third-party DAST scan repeated **every 12 months**. That's the "$50K email
  API nightmare" you'll see blogged about.
- **The personal-use exemption removes all of it.** Google's own rule: an app
  "not shared with anyone else, or used by fewer than 100 people all of whom
  are known personally to you" is **exempt from verification *and* the security
  assessment** — including for restricted scopes. A one-user app (you) is the
  cleanest possible case.
- **The 7-day refresh-token expiry** is a property of the **"Testing"**
  publishing status, not of being unverified. Move the consent screen to **"In
  Production"** and token lifetime becomes indefinite. You'll see the
  **"Google hasn't verified this app"** screen once, click *Advanced → continue*
  as the project owner, and never think about it again.

**What this means:** Argus's current README advice is correct, and there is **no
CASA, no audit, no annual fee, no 100-user ceiling risk** for your deployment.
Just publish to production and click through the one-time warning.

**Creative fallbacks if you ever want to avoid even the warning:**
- **Google Workspace "Internal" app** — if you run Argus under a Workspace
  domain you own, set the consent screen to *Internal*: exempt from the 7-day
  expiry *and* the unverified warning, no external verification at all.
- **Narrower scopes** — Argus only needs read + archive + label + draft +
  calendar-RSVP. It already avoids full-delete. If you ever want to drop out of
  the restricted tier entirely, `gmail.readonly` + `gmail.labels` covers triage
  and labeling (losing only draft-creation), which are lower-sensitivity.
- **Local tokens only** — tokens live in your SQLite on your box; nothing leaves
  your network. That's already how Argus works.

### Roadblock B — API quotas

Gmail and Calendar API per-user quotas are generous (Gmail: ~1.2M quota
units/day, ~250 units/user/sec; a triage sync costs a handful of units per
message). A single user polling a few times a day is nowhere near the ceiling.
**Non-issue** — but Argus's chunked, deduped sync already keeps it minimal.

### Roadblock C — the "last mile": trusting an agent to act

The literature is blunt: LLM agents are "**convincingly wrong**" — plausible,
confident, and incorrect — and "not every agent should run autonomously." The
canonical cautionary tale is *exactly* our threat model: "an LLM personal
assistant with email access could send a sensitive email to the wrong
recipient." The consensus mitigation is **graduated autonomy with
human-in-the-loop at the point of irreversible action** — which is precisely
Argus's trust ladder (reversible-only auto-exec, never auto-send, undo,
demotion-on-disagreement). **Argus is already built the way the research says to
build it.** The one caveat researchers stress — "most LLM judges are wildly
miscalibrated, expressing high confidence even when unreliable" — is the exact
reason Argus's calibration loop measures *empirical* accuracy from your taps
rather than trusting the model's self-reported confidence. Keep that; it's the
right instinct.

### Roadblock D — cost of an always-on agent

At ~100 items/day on Opus 4.8 with prompt caching + the Batch API, triage runs
roughly **$8–15/month** (already in the gameplan). Not a blocker. But there's a
now-viable way to take it to **~$0 and full privacy** — see the local-model
evolution below.

---

## Part 2 — Where this is heading, and Argus's roadmap

The field in 2026 has moved exactly toward what Argus is: **persistent personal
agents** — long-running assistants that "maintain identity, memory, and tool
access across sessions" and act "when the moment calls," not just when chatted
at. Long-term memory and personalization are *the* frontier. Argus's
constitution + taste-profile + calibration loops are already this. Three things
are worth building next, in priority order.

### Near-term (the highest-leverage additions)

1. **A local-model backend — privacy + zero marginal cost.** This is the
   standout finding. In 2026, the local-vs-cloud quality gap for
   *classification tasks like email triage* has narrowed to "a few percentage
   points," and models like **Qwen 3.5** (122B/10B-active, runs on a 64GB Mac)
   and **Llama 4 Scout** (109B MoE, single 24GB GPU) "compete with Claude
   Sonnet in benchmarks" with **no token cost and prompts that never leave your
   machine.** Argus already abstracts the engine behind `ARGUS_TRIAGE_MODEL` and
   a pure `triageItems()` core — adding an **Ollama backend** is a small,
   natural change. Keep Opus for the high-stakes reflection rewrite (the one
   call never to economize) and run daily triage locally. For an app whose whole
   value is handling your private inbox, "the emails never leave the house" is a
   genuinely compelling upgrade.

2. **Proactive watchers per dimension** (the gameplan's Phase 3). The field's
   defining shift is reactive → proactive: agents that surface things *before*
   you ask. Argus has the dimensions and the calendar; the natural next
   watchers are deadline/conflict detection (RSVP deadlines, double-bookings)
   and relationship nudges ("you haven't talked to Mom in a month"). Horizons
   already proves the proactive-suggestion machinery works — extend it.

3. **Notifications** (ntfy/push) so the 7am brief and "needs you now" items
   reach your phone. Small, and it's what makes an always-on agent feel alive.

### Mid-term (expand the surface)

4. **MCP for new sources — the "one inbox" vision without new UI.** MCP is
   consolidating as the standard connector protocol. Argus's normalized `items`
   stream was designed for exactly this: adding Slack, tasks, or bill/receipt
   sources becomes a connector, not a rewrite. This is also how the market's
   leaders are expanding — Shortwave's *Tasklet* wires email into
   Slack/Notion/Asana in plain English.

5. **Draft-and-hold parity, done in your voice.** Every serious product
   (Superhuman, Fyxer, Shortwave's *Ghostwriter*, Cora) now drafts replies *in
   the user's learned voice* and waits for send — never auto-sending. Argus's
   `draft_reply` already does the safe half; the upgrade is learning your voice
   from sent mail (the same flywheel as taste/constitution).

### Long-term (where Argus can be genuinely different)

6. **Lean into Horizons — nobody else is doing it.** The entire competitive
   field has converged on *clearing* the inbox (triage, draft, sort). Fyxer
   reports 81% of users save 1+ hour/day — all on *reduction*. **Almost no
   product proposes experiences that expand your life.** Argus's Horizons is a
   real wedge: the same personal context that clears your inbox can lift your
   gaze. That's the half worth investing in most, because it's the half the
   market isn't building.

7. **Multi-agent, one per dimension.** As background-agent frameworks mature, a
   coordinator that dispatches a specialist per life-area (a "wealth" agent
   watching subscriptions, a "home" agent tracking maintenance cadences) is the
   natural scaling shape — and one the current architecture (independent
   dimensions, a shared decision stream) already anticipates.

**One caution from the research to carry forward:** the 2026 literature on
background agents specifically flags "**silent memory pollution**" — long-running
agents that write to their own memory can be poisoned over time. Argus already
defends this (the reflection loop fences untrusted evidence and the golden-set
eval gate rejects regressing rewrites). As memory deepens, keep that discipline;
it's the failure mode the field is now naming.

---

## Sources

- Google — Restricted-scope & OAuth verification requirements, personal-use exemption, publishing status. developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification; support.google.com/cloud/answer/13463073
- Google OAuth refresh-token 7-day expiry (Testing vs Production). unipile.com/google-oauth-refresh-token; developers.google.com/identity/protocols/oauth2
- Gmail API scope classification (`gmail.modify`). developers.google.com/workspace/gmail/api/auth/scopes; unipile.com/gmail-api-scopes-guide
- CASA cost/cadence. deepstrike.io/blog/google-casa-security-assessment-2025; meetorbis.com/blog/how-we-passed-google-casa-tier-2-with-claude
- Local models 2026 (Qwen 3.5, Llama 4 Scout, cost/quality/privacy). aimagicx.com/blog/local-ai-models-2026; sitepoint.com/definitive-guide-local-llms-2026
- Agent reliability, graduated autonomy, HITL, judge miscalibration. arxiv.org/pdf/2509.08646; arxiv.org/pdf/2506.09420; JetBrains AI-observability blog
- Persistent/proactive agents, memory, silent memory pollution. arxiv.org/pdf/2603.23064; arxiv.org/pdf/2605.28108; mastra.ai/blog/best-personal-ai-assistants-in-2026
- Product landscape (Superhuman/Grammarly, Shortwave Tasklet/Ghostwriter, Fyxer, Cora, Carly). getinboxzero.com/blog/best-ai-email-assistants; fyxer.com/blog/best-ai-email-assistant

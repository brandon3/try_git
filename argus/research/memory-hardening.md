# Memory: hardening against silent pollution, and keeping it improving

*Research report, July 2026. Sourced from the 2026 agent-memory security and
architecture literature (OWASP ASI, the long-term-memory-security surveys,
MemAudit/SMSR, Letta/MemGPT, Generative-Agents reflection, sleep-time compute).
Citations at the end.*

## Why memory is now the frontier — and the frontier risk

The field has a name for the threat: **OWASP added ASI06 — Memory & Context
Poisoning — to the 2026 Top-10 for Agentic Applications.** The distinctive
danger, versus ordinary prompt injection, is persistence: *"memory poisoning
plants instructions that survive across sessions and execute days or weeks
later, triggered by unrelated interactions."* It's been framed as **"Poison
Once, Exploit Forever,"** with measured attack-success rates of 20–33% on
undefended agents. This is exactly the vector that touches Argus: an attacker's
email is untrusted content, and Argus has durable memory (the constitution) that
steers every future decision.

The 2026 architecture literature also names the *gap* precisely: agent memory
consolidation is almost always **agent-directed only — "there is no automated
consolidation pipeline."** The canonical fix is periodic reflection
(Generative Agents): synthesize memory by recency, relevance, and salience, and
during idle time do **"sleep-time compute" — offline consolidation that improves
memory from data already collected.**

## The guardrails the literature converges on (and Argus's status)

The recommended defense is **layered across the memory lifecycle** — write →
store → retrieve → forget — not a single filter:

| Lifecycle guardrail | What it means | Argus |
|---|---|---|
| **Provenance + trust tagging** (the #1 defense) | Every memory carries source, timestamp, trust level, validation state | **Added** — each note is tagged `user` / `inferred` / `untrusted` with `learnedFrom` provenance and a `reinforcedAt` timestamp |
| **Validation before write** | Don't write untrusted content as high-authority | **Had + extended** — reflection fences untrusted evidence and encodes patterns, not raw text; writes are now trust-tagged |
| **Trust-aware retrieval** | Only trusted/valid memory reaches the prompt | **Added** — only `active` memory is injected into triage; decayed/quarantined stays for audit, never steers |
| **Deduplication + reinforcement** | Merge redundant memory; recurrence strengthens | **Added** — consolidation dedups by fingerprint; retiring a dup reinforces its survivor |
| **Decay / forgetting** | Stale, unreinforced memory ages out | **Added** — `inferred` memory decays after 45 unused days; `user` memory is durable |
| **Quarantine of likely poisoning** | Isolate (don't trust) memory whose only support is one source and which contradicts the user's pattern | **Added** — a low-trust note contradicted by ≥3 golden cases is quarantined, not deleted (auditable) |
| **Conflict detection** | Surface contradictory rules instead of letting them coexist | **Added** — opposite directives on the same target are flagged for the next reflection |
| **Verification against ground truth** | Test that memory still helps | **Had** — the golden-set eval gate rejects any constitution rewrite that regresses past decisions |
| **Audit trail + rollback** | Every change is recorded and reversible | **Had + extended** — the constitution is versioned; consolidation now records a health snapshot each run |
| **Behavioral monitoring** — detect an agent *"defending beliefs it should never have learned"* | Watch for memory-driven drift | **Added (visible)** — a recorded memory-health score turns drift into a trend, not a surprise |

## The new loop — consolidation (loop 5)

The fifth recursive loop is Argus's **automated consolidation pipeline** — the
exact thing the literature says agents lack. It runs nightly (and before every
reflection, so the constitution is always distilled from clean memory):

1. **Dedup + reinforce** — collapse redundant notes; recurrence strengthens the survivor.
2. **Quarantine** — isolate low-trust memory the user's golden cases contradict (the anti-poisoning step).
3. **Decay** — age out stale, unreinforced `inferred` memory; keep `user` memory forever.
4. **Conflict detection** — flag contradictory rules for reflection to reconcile.
5. **Health score** — record a 0–100 memory-health metric (penalizing quarantines and conflicts) so poisoning or drift shows up as a downward trend on the dashboard.

This closes the loop the research describes: the learning loops *write* memory,
consolidation keeps it *clean*, the eval gate keeps rewrites *honest*, and the
health score keeps the whole thing *observable*.

## Near-future directions worth tracking

- **Sleep-time compute** — the consolidation loop is a first instance; the
  richer version does offline *improvement* (re-deriving better rules from
  history) during idle time, not just hygiene.
- **Memory benchmarks** (LoCoMo, LongMemEval, BEAM) — the analog for Argus is
  the golden set; growing it into a standing multi-session memory eval would let
  Argus measure whether memory genuinely improves decisions over time.
- **Post-hoc causal auditing** (MemAudit-style) — attribute a bad decision back
  to the specific memory that caused it. Argus's `learnedFrom` provenance is the
  hook; a "why did you do that?" trace is the natural next feature.
- **Tiered memory** (Letta/MemGPT core/archival/recall) — if Argus's memory ever
  outgrows SQLite-and-a-prompt, the episodic/semantic/procedural split is the
  proven shape.

## Sources

- OWASP — ASI06 Memory & Context Poisoning (Top-10 Agentic 2026); genai.owasp.org
- A Survey on Long-Term Memory Security in LLM Agents (attacks/defenses/governance across the lifecycle). arxiv.org/abs/2604.16548
- Memory Poisoning Attack and Defense on Memory-Based LLM Agents. arxiv.org/abs/2601.05504
- MemAudit — post-hoc auditing of poisoned memory via causal attribution. arxiv.org/abs/2605.23723
- SMSR — certified defence against runtime memory poisoning. arxiv.org/abs/2606.12703
- "Poison Once, Exploit Forever" / sleeper attacks. arxiv.org/abs/2605.28201; christian-schneider.net/blog/persistent-memory-poisoning-in-ai-agents
- Provenance-aware guardrails (CaMeL, Fides, Agent-Sentry). arxiv.org/abs/2606.04990
- Agent memory architectures & the consolidation gap (Letta/MemGPT, Generative-Agents reflection). zylos.ai/research/2026-04-05-ai-agent-memory-architectures; jobsbyculture.com/blog/ai-agent-memory-systems-guide-2026
- Sleep-time compute / self-consolidation for self-evolving agents. arxiv.org/abs/2602.01966
- Memory benchmarks (LoCoMo, LongMemEval, BEAM). mem0.ai/blog/ai-memory-benchmarks-in-2026

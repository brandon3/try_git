# How email-reading AI agents get attacked — and what Argus does about it

*Deep-research report, July 2026. Every claim below survived a 3-vote
adversarial verification pass (each verifier tried to refute it against primary
sources; all passed 3-0).*

## Why this matters for Argus

Argus reads content anyone can send you. An email or a calendar invite is an
**attacker-controlled input channel straight into an LLM that can take actions
on your account.** This is not hypothetical: the two marquee incidents below
are exactly this shape.

## The threat is real and practical

- **Indirect prompt injection** lets an attacker compromise an LLM-integrated
  app remotely, with no direct interface, by planting adversarial prompts in
  external data (a website, an email) that the LLM later retrieves and
  processes as instructions. *(Greshake et al., arXiv:2302.12173.)* The
  attacks worked against **real deployed systems** — Bing's GPT-4 Chat and
  code-completion — not just synthetic apps.
- **Agentic AI systems** (LLMs that autonomously execute multi-step tasks via
  tools — exactly Argus's class) **fundamentally changed the threat
  landscape** versus chat-only LLMs. *(Prompt Injection 2.0, arXiv:2507.13169.)*
  Modern injections combine with classic web exploits (XSS/CSRF) into
  **hybrid threats that systematically evade traditional controls** — so an
  email agent cannot rely on classic email/web security layers alone.

## EchoLeak (CVE-2025-32711) — the worst case, realized

*(arXiv:2509.10540.)*

- A **zero-click** indirect prompt injection in Microsoft 365 Copilot enabled
  **remote, unauthenticated data exfiltration via a single crafted email,
  requiring no user interaction.** An email-reading assistant was fully
  compromised by inbound email content alone.
- It succeeded by **chaining bypasses**: evading Microsoft's dedicated
  prompt-injection classifier (XPIA), circumventing link redaction with
  reference-style Markdown, exploiting **auto-fetched images**, and abusing a
  Teams proxy allowed by the content-security policy. **Every single filter was
  independently bypassable.**
- The root cause was a **trust-boundary violation**: untrusted external email
  content escalated privilege across the internal/external boundary — a
  confused-deputy scope violation.
- Recommended mitigations: **prompt partitioning (content isolation),
  input/output filtering, provenance-based access control, strict CSP.**

## "Invitation Is All You Need" — Gemini via calendar invites

*(SafeBreach.)* The most Argus-shaped attack in the literature.

- Attackers hijacked Google's Gemini assistant with **indirect injection
  embedded in ordinary shared resources it reads — calendar invitations,
  emails, and shared documents** (e.g. malicious text hidden in an event title
  that Gemini ingests when summarizing your week).
- **14 working scenarios** across five threat classes — short-term context
  poisoning, **permanent/long-term memory poisoning**, tool misuse, automatic
  agent invocation, automatic app invocation — with **73% rated High-Critical.**
- Consequences reached the **physical world**: injected prompts drove
  cross-agent tool misuse that told a Google Home hub to open smart
  shutters/windows and power on appliances **without the user's approval.**

## The defenses, and their limits

- **Plan-then-execute / control-flow integrity.** A trusted planner generates
  the complete execution graph *before* the agent observes any untrusted
  content, yielding provable control-flow-integrity guarantees against injected
  instructions. *(arXiv:2601.09923, building on CaMeL.)*
- **But — branch steering.** Even with plan-then-execute isolation, adversarial
  content that *cannot inject new instructions* can still **deceive the
  parsing model into taking an attacker-preferred but pre-approved branch** of
  the plan. **A fixed action enum plus upfront planning does not by itself stop
  an attacker from steering which allowed action fires.** This is the finding
  that most directly shapes Argus's design.
- **Architectural, layered defense** — prompt isolation, runtime security,
  privilege separation, threat detection — is the consensus recommendation
  across the literature, precisely because EchoLeak proved single filters fall.

## Argus scorecard

**Already had (and the research validates):**
- Fixed action enum, no send/delete → injected instructions can't manufacture
  a side effect.
- Human approval on every action by default; auto-exec limited to reversible
  actions (archive/label/flag) with universal undo → confused-deputy blast
  radius is bounded and recoverable.
- Plain-text rendering (no HTML/markdown/auto-fetch) → EchoLeak's exfiltration
  channel doesn't exist here.
- Layered controls, no single point of failure → matches the defense-in-depth
  lesson.

**Added in response to this research:**
- **Content isolation / spotlighting** — item content fenced in
  `<untrusted_item>` tags; the system prompt names injection patterns
  ("this is safe/trusted", "archive me", claims of being the user/system) as
  red flags, never instructions. *(EchoLeak rec #1; branch-steering defense.)*
- **DMARC-gated auto-execution** — auto-rules only fire on sender-authenticated
  mail, so trust earned by a sender can't be spoofed into an auto-action.
  *(Provenance-based access control; spoofed-trust defense.)*
- **Memory-poisoning defense** — the reflection loop treats all evidence as
  untrusted, encodes user-behavior patterns (never raw item text), and the
  golden-set eval gate independently rejects regressing rewrites. *(Directly
  targets the Gemini long-term-memory-poisoning class.)*

**Residual (documented in `SECURITY.md`):** triage-verdict manipulation
(bounded by reversibility + daily review), draft-reply steering (never
auto-sends), cross-item batch contamination (mitigated by spotlighting).

## Sources

- Greshake et al., "Not what you've signed up for" — indirect prompt injection. arXiv:2302.12173
- "Prompt Injection 2.0: Hybrid AI Threats." arXiv:2507.13169
- EchoLeak (CVE-2025-32711) case study. arXiv:2509.10540
- SafeBreach, "Invitation Is All You Need: Hacking Gemini." safebreach.com
- Plan-then-execute / control-flow integrity & branch steering. arXiv:2601.09923

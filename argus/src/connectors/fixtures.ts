import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

// Sandbox stand-in for the Gmail/Calendar connectors. Same contract the
// real connectors will have: sync() upserts normalized rows into `items`.
// At home, this file's siblings (gmail.ts, gcal.ts) replace it.

type Fixture = {
  externalId: string;
  kind: "email" | "event";
  title: string;
  from?: string;
  bodySnippet?: string;
  occursAt?: Date;
};

const now = Date.now();
const hours = (n: number) => new Date(now + n * 3600_000);

const FIXTURES: Fixture[] = [
  {
    externalId: "em-001",
    kind: "email",
    title: "Your car registration expires in 9 days",
    from: "dmv@notifications.state.gov",
    bodySnippet:
      "Vehicle registration for plate 7ABC123 expires soon. Renew online to avoid late fees.",
  },
  {
    externalId: "em-002",
    kind: "email",
    title: "This week in AI — Issue #204",
    from: "newsletter@aidigest.io",
    bodySnippet:
      "Top stories: new model releases, agent frameworks roundup... Unsubscribe at any time.",
  },
  {
    externalId: "em-003",
    kind: "email",
    title: "Re: Q3 planning doc — need your section by Friday",
    from: "maya@work.example.com",
    bodySnippet:
      "Hey, just a reminder that your roadmap section is the last one missing. Can you get it in by EOD Friday?",
  },
  {
    externalId: "em-004",
    kind: "email",
    title: "Your subscription price is changing",
    from: "billing@streamco.com",
    bodySnippet:
      "Starting next month, your plan increases from $11.99 to $15.99/mo. No action needed to continue.",
  },
  {
    externalId: "em-005",
    kind: "email",
    title: "50% OFF everything — final hours!",
    from: "deals@megastore.shop",
    bodySnippet: "Don't miss out! Sale ends at midnight. Shop now.",
  },
  {
    externalId: "em-006",
    kind: "email",
    title: "Invitation to speak at DevConf in October",
    from: "organizers@devconf.example.org",
    bodySnippet:
      "We'd love to have you give a 30-minute talk. Travel covered. RSVP by July 15 so we can lock the schedule.",
  },
  {
    externalId: "ev-001",
    kind: "event",
    title: "Team standup (optional)",
    from: "calendar",
    bodySnippet: "Recurring optional sync, agenda-less.",
    occursAt: hours(26),
  },
  {
    externalId: "ev-002",
    kind: "event",
    title: "Dentist appointment",
    from: "calendar",
    bodySnippet: "Cleaning + checkup, Main St clinic.",
    occursAt: hours(50),
  },
  {
    externalId: "ev-003",
    kind: "event",
    title: "1:1 with Maya — CONFLICTS with Dentist",
    from: "calendar",
    bodySnippet: "Overlaps the dentist slot; one of these has to move.",
    occursAt: hours(50),
  },
  {
    externalId: "em-007",
    kind: "email",
    title: "Security alert: new sign-in on Windows device",
    from: "no-reply@accounts.example.com",
    bodySnippet:
      "We noticed a new sign-in from a device you don't usually use. If this wasn't you, secure your account.",
  },
  {
    externalId: "em-008",
    kind: "email",
    title: "Your June investment statement is ready",
    from: "statements@vanguard.example.com",
    bodySnippet: "Your account statement for June is available. No action required.",
  },
  {
    externalId: "em-009",
    kind: "email",
    title: "Gym membership renews July 15 — now $89/mo",
    from: "billing@ironworks.gym",
    bodySnippet:
      "Your annual membership renews automatically on July 15 at the new rate of $89/mo (was $74).",
  },
  {
    externalId: "ev-004",
    kind: "event",
    title: "Mom's birthday 🎂",
    from: "calendar",
    bodySnippet: "All-day. You usually call in the morning and send flowers.",
    occursAt: hours(72),
  },
  {
    externalId: "em-010",
    kind: "email",
    title: "Furnace filter replacement due (90-day reminder)",
    from: "reminders@homekeeper.app",
    bodySnippet: "It's been 90 days since the last filter change. MERV-13, 16x25x1.",
  },
  {
    externalId: "em-011",
    kind: "email",
    title: "Presale code inside: The National at the Greek Theatre",
    from: "presale@tickets.example.com",
    bodySnippet: "Your artist presale starts Thursday 10am. Code: HIGHVIOLET.",
  },
  // Repeats from the same sender — the raw material for the shadow-experiment
  // loop: approve archiving these a few times and Argus notices the pattern.
  {
    externalId: "em-012",
    kind: "email",
    title: "This week in AI — Issue #205",
    from: "newsletter@aidigest.io",
    bodySnippet: "Top stories: eval harnesses, agents in production... Unsubscribe at any time.",
  },
  {
    externalId: "em-013",
    kind: "email",
    title: "This week in AI — Issue #206",
    from: "newsletter@aidigest.io",
    bodySnippet: "Top stories: long-context tricks, memory patterns... Unsubscribe at any time.",
  },
  {
    externalId: "em-014",
    kind: "email",
    title: "This week in AI — Issue #207",
    from: "newsletter@aidigest.io",
    bodySnippet: "Top stories: multi-agent orchestration... Unsubscribe at any time.",
  },
  {
    externalId: "em-015",
    kind: "email",
    title: "This week in AI — Issue #208",
    from: "newsletter@aidigest.io",
    bodySnippet: "Top stories: structured outputs everywhere... Unsubscribe at any time.",
  },
];

// "The next morning": arrives only after everything above has been synced,
// so a second brief run demonstrates promoted rules auto-executing.
const WAVE_2: Fixture[] = [
  {
    externalId: "em-016",
    kind: "email",
    title: "This week in AI — Issue #209",
    from: "newsletter@aidigest.io",
    bodySnippet: "Top stories: the agentic web... Unsubscribe at any time.",
  },
  {
    externalId: "em-017",
    kind: "email",
    title: "FLASH SALE: 60% off — today only!",
    from: "deals@megastore.shop",
    bodySnippet: "Biggest discounts of the season. Shop now before it's gone.",
  },
];

export async function sync(): Promise<{ inserted: number }> {
  let source = db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.kind, "fixtures"))
    .get();
  if (!source) {
    source = db
      .insert(schema.sources)
      .values({ kind: "fixtures", label: "Sandbox fixtures", createdAt: new Date() })
      .returning()
      .get();
  }

  const insertMissing = (fixtures: Fixture[]) => {
    let inserted = 0;
    for (const f of fixtures) {
      const exists = db
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(eq(schema.items.externalId, f.externalId))
        .get();
      if (exists) continue;
      db.insert(schema.items)
        .values({
          sourceId: source.id,
          externalId: f.externalId,
          kind: f.kind,
          title: f.title,
          from: f.from,
          bodySnippet: f.bodySnippet,
          occursAt: f.occursAt,
          authenticated: true, // sandbox fixtures are a trusted local source
          createdAt: new Date(),
        })
        .run();
      inserted++;
    }
    return inserted;
  };

  // Wave 1 first; wave 2 ("the next morning") only once wave 1 is in.
  let inserted = insertMissing(FIXTURES);
  if (inserted === 0) inserted = insertMissing(WAVE_2);
  return { inserted };
}

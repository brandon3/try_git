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

  let inserted = 0;
  for (const f of FIXTURES) {
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
        createdAt: new Date(),
      })
      .run();
    inserted++;
  }
  return { inserted };
}

import { google, calendar_v3 } from "googleapis";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { authedClient } from "./google";

// Calendar connector: sync() pulls the next 7 days into `items`;
// respond() is called by the executor to accept/decline invitations.

function api(): { cal: calendar_v3.Calendar; sourceId: number } | null {
  const authed = authedClient("gcal");
  if (!authed) return null;
  return { cal: google.calendar({ version: "v3", auth: authed.client }), sourceId: authed.sourceId };
}

export async function sync(): Promise<{ inserted: number }> {
  const g = api();
  if (!g) return { inserted: 0 };

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 3600_000);

  // Page through the whole 7-day window — a full calendar can hold more than
  // one page of events, and events.list only returns the first page; without
  // following nextPageToken the later events are silently dropped. MAX_PAGES
  // bounds a single sync.
  const events: calendar_v3.Schema$Event[] = [];
  const MAX_PAGES = 10;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await g.cal.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: weekOut.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    events.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  let inserted = 0;
  for (const ev of events) {
    const externalId = `gcal:${ev.id}`;
    const exists = db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(eq(schema.items.externalId, externalId))
      .get();
    if (exists) continue;

    const start = ev.start?.dateTime ?? ev.start?.date;
    db.insert(schema.items)
      .values({
        sourceId: g.sourceId,
        externalId,
        kind: "event",
        title: ev.summary ?? "(untitled event)",
        from: ev.organizer?.email ?? "calendar",
        bodySnippet: [
          ev.description?.slice(0, 200),
          ev.attendees ? `${ev.attendees.length} attendees` : null,
          ev.status === "tentative" || needsRsvp(ev) ? "awaiting your RSVP" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        occursAt: start ? new Date(start) : undefined,
        createdAt: new Date(),
      })
      .run();
    inserted++;
  }
  return { inserted };
}

function needsRsvp(ev: calendar_v3.Schema$Event): boolean {
  return (
    ev.attendees?.some((a) => a.self && a.responseStatus === "needsAction") ?? false
  );
}

// ── Actions (invoked by the executor, post-approval only) ──────────

export async function respond(
  eventId: string,
  response: "accepted" | "declined",
): Promise<string> {
  const g = api();
  if (!g) throw new Error("Calendar not connected");
  const ev = await g.cal.events.get({ calendarId: "primary", eventId });
  const attendees = (ev.data.attendees ?? []).map((a) =>
    a.self ? { ...a, responseStatus: response } : a,
  );
  await g.cal.events.patch({
    calendarId: "primary",
    eventId,
    // Notify the organizer of the RSVP, as a human accept/decline would.
    sendUpdates: "all",
    requestBody: { attendees },
  });
  return `${response} calendar event ${eventId}`;
}

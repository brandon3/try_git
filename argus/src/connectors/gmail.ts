import { google, gmail_v1 } from "googleapis";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { authedClient } from "./google";

// Gmail connector: sync() pulls recent inbox mail into `items`;
// the action functions are called by the executor after approval.

function api(): { gmail: gmail_v1.Gmail; sourceId: number } | null {
  const authed = authedClient("gmail");
  if (!authed) return null;
  return { gmail: google.gmail({ version: "v1", auth: authed.client }), sourceId: authed.sourceId };
}

function header(msg: gmail_v1.Schema$Message, name: string): string | undefined {
  return msg.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  )?.value ?? undefined;
}

export async function sync(): Promise<{ inserted: number }> {
  const g = api();
  if (!g) return { inserted: 0 };

  // Recent, still-in-inbox mail. The 3-day window overlaps between runs;
  // the external_id unique constraint dedupes.
  const list = await g.gmail.users.messages.list({
    userId: "me",
    q: "in:inbox newer_than:3d",
    maxResults: 50,
  });

  // Skip already-imported ids, then fetch the rest in parallel chunks —
  // serial N+1 fetches make a big inbox sync needlessly slow.
  const fresh = (list.data.messages ?? []).filter((ref) => {
    const exists = db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(eq(schema.items.externalId, `gmail:${ref.id}`))
      .get();
    return !exists;
  });

  let inserted = 0;
  const CHUNK = 10;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    const messages = await Promise.all(
      chunk.map((ref) =>
        g.gmail.users.messages.get({
          userId: "me",
          id: ref.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From"],
        }),
      ),
    );
    for (const msg of messages) {
      const result = db
        .insert(schema.items)
        .values({
          sourceId: g.sourceId,
          externalId: `gmail:${msg.data.id}`,
          kind: "email",
          title: header(msg.data, "Subject") ?? "(no subject)",
          from: header(msg.data, "From"),
          bodySnippet: msg.data.snippet ?? undefined,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .run();
      if (result.changes > 0) inserted++;
    }
  }
  return { inserted };
}

// ── Actions (invoked by the executor, post-approval only) ──────────

export async function archive(messageId: string): Promise<string> {
  const g = api();
  if (!g) throw new Error("Gmail not connected");
  await g.gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
  return `archived gmail message ${messageId}`;
}

export async function unarchive(messageId: string): Promise<string> {
  const g = api();
  if (!g) throw new Error("Gmail not connected");
  await g.gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: ["INBOX"] },
  });
  return `restored gmail message ${messageId} to inbox`;
}

export async function label(messageId: string, labelName: string): Promise<string> {
  const g = api();
  if (!g) throw new Error("Gmail not connected");
  const labels = await g.gmail.users.labels.list({ userId: "me" });
  let labelId = labels.data.labels?.find((l) => l.name === labelName)?.id;
  if (!labelId) {
    const created = await g.gmail.users.labels.create({
      userId: "me",
      requestBody: { name: labelName },
    });
    labelId = created.data.id!;
  }
  await g.gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
  return `labeled gmail message ${messageId} as ${labelName}`;
}

export async function unlabel(messageId: string, labelName: string): Promise<string> {
  const g = api();
  if (!g) throw new Error("Gmail not connected");
  const labels = await g.gmail.users.labels.list({ userId: "me" });
  const labelId = labels.data.labels?.find((l) => l.name === labelName)?.id;
  if (labelId) {
    await g.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: [labelId] },
    });
  }
  return `removed label ${labelName} from gmail message ${messageId}`;
}

// Creates a draft in the thread — never sends. Sending stays a human act.
export async function draftReply(messageId: string, body: string): Promise<string> {
  const g = api();
  if (!g) throw new Error("Gmail not connected");
  const msg = await g.gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Subject", "From", "Message-ID"],
  });
  const subject = header(msg.data, "Subject") ?? "";
  const to = header(msg.data, "From") ?? "";
  const inReplyTo = header(msg.data, "Message-ID");

  const raw = Buffer.from(
    [
      `To: ${to}`,
      `Subject: ${subject.startsWith("Re:") ? subject : `Re: ${subject}`}`,
      inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
      inReplyTo ? `References: ${inReplyTo}` : "",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ]
      .filter(Boolean)
      .join("\r\n"),
  ).toString("base64url");

  await g.gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, threadId: msg.data.threadId ?? undefined } },
  });
  return `drafted reply on gmail thread ${msg.data.threadId}`;
}

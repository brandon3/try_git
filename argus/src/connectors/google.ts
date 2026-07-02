import { google, Auth } from "googleapis";
type OAuth2Client = Auth.OAuth2Client;
type Credentials = Auth.Credentials;
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

// Shared Google OAuth plumbing for the Gmail and Calendar connectors.
//
// Setup at home (one time):
//   1. Google Cloud console → create project → enable Gmail API + Calendar API
//   2. OAuth consent screen: set publishing status to "In production".
//      Do NOT leave it in "Testing" — Google expires refresh tokens after
//      7 days for testing-status apps, which would silently break Argus
//      weekly. Production status shows a one-time "unverified app" warning
//      during consent (fine for personal use) and tokens don't expire.
//   3. Create OAuth client (Web application), redirect URI:
//      http://<home-server>:3000/api/auth/callback
//   4. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
//   5. Visit /api/auth/google once from a browser on your network

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
];

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback",
  );
}

export function authUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline", // refresh token, so the 7am cron never needs a browser
    prompt: "consent",
    scope: SCOPES,
  });
}

function getSource(kind: "gmail" | "gcal") {
  return db.select().from(schema.sources).where(eq(schema.sources.kind, kind)).get();
}

function upsertSource(kind: "gmail" | "gcal", tokens: Credentials) {
  const existing = getSource(kind);
  if (existing) {
    db.update(schema.sources)
      .set({ credentials: JSON.stringify(tokens) })
      .where(eq(schema.sources.id, existing.id))
      .run();
    return existing.id;
  }
  return db
    .insert(schema.sources)
    .values({
      kind,
      label: `Google ${kind === "gmail" ? "Mail" : "Calendar"}`,
      credentials: JSON.stringify(tokens),
      createdAt: new Date(),
    })
    .returning()
    .get().id;
}

// OAuth callback: exchange the code and store tokens for both connectors.
export async function handleCallback(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  upsertSource("gmail", tokens);
  upsertSource("gcal", tokens);
}

// Returns an authed client whose refreshed tokens are persisted back to the
// source row, or null if the user hasn't completed OAuth yet.
export function authedClient(kind: "gmail" | "gcal"): {
  client: OAuth2Client;
  sourceId: number;
} | null {
  const source = getSource(kind);
  if (!source?.credentials) return null;
  const client = oauthClient();
  client.setCredentials(JSON.parse(source.credentials) as Credentials);
  client.on("tokens", (tokens) => {
    const merged = { ...JSON.parse(source.credentials!), ...tokens };
    db.update(schema.sources)
      .set({ credentials: JSON.stringify(merged) })
      .where(eq(schema.sources.id, source.id))
      .run();
  });
  return { client, sourceId: source.id };
}

export function googleConnected(): boolean {
  return !!getSource("gmail")?.credentials;
}

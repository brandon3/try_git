import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authUrl, googleConfigured } from "@/connectors/google";

// GET /api/auth/google — kick off the one-time OAuth consent flow.
// A random `state` is minted here, stashed in an httpOnly cookie, and echoed
// back by Google to the callback, which rejects any mismatch. This blocks
// login-CSRF: an attacker can't trick the browser into completing OAuth with
// their own authorization code (which would bind Argus to the attacker's
// Google account), because they can't produce a matching state cookie.
export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first" },
      { status: 400 },
    );
  }
  const state = randomUUID();
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("argus_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    maxAge: 600, // 10 minutes to complete consent
    path: "/",
  });
  return res;
}

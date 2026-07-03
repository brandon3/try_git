import { NextRequest, NextResponse } from "next/server";
import { handleCallback } from "@/connectors/google";

// GET /api/auth/callback?code=...&state=... — OAuth redirect target. Stores
// tokens and returns to the dashboard, now connected to real Gmail/Calendar.
//
// This route is exempt from ARGUS_SECRET auth (Google redirects here without
// our cookie), so the `state` check is the CSRF guard: the state must match
// the one minted in /api/auth/google and stored in an httpOnly cookie.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get("argus_oauth_state")?.value;

  if (!code) {
    return NextResponse.json({ error: "Missing ?code" }, { status: 400 });
  }
  if (!state || !expected || state !== expected) {
    return NextResponse.json(
      { error: "Invalid OAuth state — start again from /api/auth/google" },
      { status: 400 },
    );
  }

  await handleCallback(code);
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete("argus_oauth_state");
  return res;
}

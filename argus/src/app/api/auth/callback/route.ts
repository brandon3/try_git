import { NextRequest, NextResponse } from "next/server";
import { handleCallback } from "@/connectors/google";

// GET /api/auth/callback?code=... — OAuth redirect target. Stores tokens
// and returns to the dashboard, now connected to real Gmail/Calendar.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing ?code" }, { status: 400 });
  }
  await handleCallback(code);
  return NextResponse.redirect(new URL("/", req.url));
}

import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/connectors/google";

// GET /api/auth/google — kick off the one-time OAuth consent flow.
export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first" },
      { status: 400 },
    );
  }
  return NextResponse.redirect(authUrl());
}

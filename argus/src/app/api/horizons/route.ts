import { NextResponse } from "next/server";
import { scanHorizons, openHorizons, savedHorizons } from "@/engine/horizons";

// POST /api/horizons — scan the horizon now (button; cron calls scanHorizons directly).
export async function POST() {
  const result = await scanHorizons();
  return NextResponse.json(result);
}

// GET /api/horizons — open suggestions plus what the user has saved.
export async function GET() {
  return NextResponse.json({ open: openHorizons(), saved: savedHorizons() });
}

import * as fixtures from "./fixtures";
import * as gmail from "./gmail";
import * as gcal from "./gcal";
import { googleConnected } from "./google";

// Single entry point the brief uses. Once Google OAuth has been completed
// (visit /api/auth/google), real sources take over and fixtures retire.
export async function syncAll(): Promise<Record<string, { inserted: number }>> {
  if (googleConnected()) {
    return {
      gmail: await gmail.sync(),
      gcal: await gcal.sync(),
    };
  }
  return { fixtures: await fixtures.sync() };
}

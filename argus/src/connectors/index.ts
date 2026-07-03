import * as fixtures from "./fixtures";
import * as gmail from "./gmail";
import * as gcal from "./gcal";
import { googleConfigured, googleConnected } from "./google";

// Single entry point the brief uses. Once Google OAuth has been completed
// (visit /api/auth/google), real sources take over and fixtures retire.
//
// The middle state matters: when credentials are CONFIGURED but OAuth hasn't
// been completed yet (e.g. the 7am cron fires before the one-time consent
// visit), Argus must sync nothing — not fall back to fixtures. Fixture emails
// are marked authenticated and would be triaged by the real engine alongside
// real mail; responses to them would permanently seed the golden set, shadow
// experiments, and memory with fabricated senders. Fixtures are for the
// sandbox only, where no Google credentials exist at all.
export async function syncAll(): Promise<Record<string, { inserted: number }>> {
  if (googleConnected()) {
    return {
      gmail: await gmail.sync(),
      gcal: await gcal.sync(),
    };
  }
  if (googleConfigured()) {
    return { google: { inserted: 0 } }; // awaiting OAuth — never fixtures
  }
  return { fixtures: await fixtures.sync() };
}

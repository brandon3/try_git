import { NextRequest, NextResponse } from "next/server";

// Single-user auth: set ARGUS_SECRET and every request must carry it —
// either as a Bearer token (for curl/cron) or via the cookie set by
// visiting any page once with ?key=<secret>. Unset ARGUS_SECRET (e.g. in
// the sandbox) and the app is open, for use behind Tailscale only.
//
// Constant-ish comparison is not load-bearing here (single user, LAN), but
// keeping the secret out of URLs after first visit is: the redirect strips
// ?key= so it doesn't linger in browser history.

export function middleware(req: NextRequest) {
  const secret = process.env.ARGUS_SECRET;
  if (!secret) return NextResponse.next();

  const url = req.nextUrl;

  // First visit: /?key=SECRET → set cookie, redirect to clean URL.
  const key = url.searchParams.get("key");
  if (key === secret) {
    const clean = url.clone();
    clean.searchParams.delete("key");
    const res = NextResponse.redirect(clean);
    res.cookies.set("argus_key", secret, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  }

  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return NextResponse.next();
  if (req.cookies.get("argus_key")?.value === secret) return NextResponse.next();

  // The Google OAuth callback arrives from Google's redirect without our
  // cookie in some cross-site configurations; it carries an unguessable
  // one-time code and only stores tokens for the configured client.
  if (url.pathname === "/api/auth/callback") return NextResponse.next();

  return new NextResponse(
    JSON.stringify({ error: "unauthorized — visit /?key=<ARGUS_SECRET> once" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

export const config = {
  // Everything except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};

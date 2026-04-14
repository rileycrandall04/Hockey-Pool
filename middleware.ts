import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Name of the cookie we use to remember the user's "current league"
 * across global pages (dashboard, /players, /players/[id], /debug/nhl).
 *
 * Set on every visit to a /leagues/{id}/... URL so tapping Players in
 * the navbar keeps you visually inside that league. Cleared when the
 * user explicitly hits /dashboard via the Switch leagues menu item.
 */
const LEAGUE_COOKIE = "current_league_id";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  // Never touch the cookie for static assets or cron calls — those
  // requests get served by different matchers below, but be defensive
  // in case the matcher changes.
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/cron")) {
    return response;
  }

  // Remember / forget the current league based on where the user went.
  const leagueMatch = pathname.match(/^\/leagues\/([^/]+)/);
  if (leagueMatch) {
    const leagueId = leagueMatch[1];
    // Skip the literal "new" / "join" sub-routes — they're not league
    // instance ids.
    if (leagueId !== "new" && leagueId !== "join") {
      response.cookies.set(LEAGUE_COOKIE, leagueId, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }
  } else if (pathname === "/dashboard") {
    // /dashboard is where "Switch leagues" lands, so clear the
    // league-context cookie here. This is the single exit door out
    // of a league — every other global page preserves the context.
    response.cookies.delete(LEAGUE_COOKIE);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image, favicon, public assets
     * - /api/cron (authenticated via CRON_SECRET, not a user cookie)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

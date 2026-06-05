import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Cookie that remembers the user's "current league" so global pages can
 * keep them visually inside that league. Set on every /leagues/{id}/...
 * visit; cleared on /dashboard (the "switch leagues" exit door).
 */
const LEAGUE_COOKIE = "current_league_id";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/cron")) {
    return response;
  }

  const leagueMatch = pathname.match(/^\/leagues\/([^/]+)/);
  if (leagueMatch) {
    const leagueId = leagueMatch[1];
    if (leagueId !== "new" && leagueId !== "join") {
      response.cookies.set(LEAGUE_COOKIE, leagueId, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
  } else if (pathname === "/dashboard") {
    response.cookies.delete(LEAGUE_COOKIE);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

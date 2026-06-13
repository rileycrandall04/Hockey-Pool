import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_VIEW_COOKIE } from "@/lib/public-view";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Refreshes the Supabase session on every request so server components
 * always see up-to-date auth state, and redirects unauthenticated
 * visitors away from gated routes.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const publicPaths = [
    "/",
    "/login",
    "/signup",
    "/auth",
    "/forgot-password",
    "/reset-password",
    "/share",
    "/invalid-share",
  ];
  const isPublic = publicPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // A logged-out visitor holding a share link may browse league pages. This is
  // only a coarse gate keyed on the cookie's presence; each league page still
  // re-validates the token against the league before showing anything.
  const isSharedLeagueView =
    pathname.startsWith("/leagues/") &&
    request.cookies.has(PUBLIC_VIEW_COOKIE);

  if (!user && !isPublic && !isSharedLeagueView) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

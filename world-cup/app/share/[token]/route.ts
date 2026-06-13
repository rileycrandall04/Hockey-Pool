import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { PUBLIC_VIEW_COOKIE } from "@/lib/public-view";

/**
 * Entry point for a read-only share link. Resolves /share/<token> to its
 * league, drops the share cookie, and forwards the visitor into the normal
 * league pages — where the token is re-validated on every request. An unknown
 * token lands on a friendly "link no longer works" page.
 *
 * A Route Handler (not a page) because it needs to set a cookie, which Next
 * only allows in handlers and server actions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("id")
    .eq("public_view_token", token)
    .single();

  if (!league) {
    return NextResponse.redirect(new URL("/invalid-share", request.url));
  }

  const response = NextResponse.redirect(
    new URL(`/leagues/${league.id}`, request.url),
  );
  response.cookies.set(PUBLIC_VIEW_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 60, // 60 days
  });
  return response;
}

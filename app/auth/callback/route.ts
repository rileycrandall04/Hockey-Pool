import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * OAuth / PKCE code-exchange callback.
 *
 * Supabase's password-reset email redirects the browser to
 * `/auth/callback?code=XXX&next=/reset-password`. This route hands
 * the code off to `supabase.auth.exchangeCodeForSession(code)`,
 * which sets the session cookies via the SSR client's cookie
 * handler, and then sends the user on to the `next` URL with a
 * valid session in place. If the exchange fails (expired link,
 * forged code) we redirect to /login with an error flash.
 *
 * Also usable for any other future flow that needs a PKCE exchange
 * (magic-link sign-in, OAuth providers, etc.) — the route is
 * intentionally flow-agnostic; it just exchanges whatever code is
 * in the query string and forwards to `next`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL(
        "/login?error=" +
          encodeURIComponent("Missing auth code in callback URL"),
        url.origin,
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        "/login?error=" +
          encodeURIComponent(`Auth exchange failed: ${error.message}`),
        url.origin,
      ),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

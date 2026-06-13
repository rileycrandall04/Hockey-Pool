/**
 * Name of the cookie that grants a logged-out visitor read-only access to a
 * single league. Its value is that league's `public_view_token` — the secret
 * embedded in a /share/<token> link. The cookie is only a coarse hint; every
 * page re-validates the token against the league row before trusting it, so a
 * forged cookie grants nothing.
 *
 * Kept in its own dependency-free module so the edge middleware can import the
 * constant without pulling in server-only Supabase code.
 */
export const PUBLIC_VIEW_COOKIE = "public_league_view";

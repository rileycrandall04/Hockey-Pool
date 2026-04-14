/**
 * Returns true if the given email is the configured "app owner" — the
 * person who set up this deployment of the pool. Used to gate global
 * actions like Refresh NHL data so random pool members can't trigger
 * them and burn serverless function quota for everyone else.
 *
 * Configuration: set APP_OWNER_EMAIL in your Vercel project env vars to
 * the exact email address you signed up to the pool with. The match is
 * case-insensitive but otherwise exact (no aliases, no wildcards).
 *
 * Backwards-compat behavior: if APP_OWNER_EMAIL is unset (the default
 * during initial setup), this function returns true for everyone, so
 * the lockdown only takes effect once you opt in by setting the var.
 *
 * Server-side only — APP_OWNER_EMAIL is intentionally NOT prefixed with
 * NEXT_PUBLIC_ so it's never bundled into client JS.
 */
export function isAppOwner(email: string | null | undefined): boolean {
  const owner = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return true; // open mode — env var not configured
  if (!email) return false;
  return email.trim().toLowerCase() === owner;
}

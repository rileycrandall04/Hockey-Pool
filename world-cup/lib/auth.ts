/**
 * Returns true if the given email is the configured "app owner" — the
 * person who set up this deployment. Used to gate global actions (seeding,
 * data refresh) so random members can't trigger them.
 *
 * Set APP_OWNER_EMAIL in your env to the exact email you signed up with
 * (case-insensitive). If unset, this returns true for everyone, so the
 * lockdown only takes effect once you opt in.
 *
 * Server-side only — intentionally NOT prefixed with NEXT_PUBLIC_.
 */
export function isAppOwner(email: string | null | undefined): boolean {
  const owner = process.env.APP_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return true; // open mode — env var not configured
  if (!email) return false;
  return email.trim().toLowerCase() === owner;
}

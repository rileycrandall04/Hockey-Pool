-- Read-only public share links.
--
-- Every league gets a permanent, unguessable `public_view_token`. The token is
-- the secret in a /share/<token> URL; anyone holding the link can browse the
-- league (standings, teams, schedule, scores, …) read-only without an account.
-- There is no toggle — sharing is always on, per league. Regenerating the
-- token (a manual UPDATE) is the way to revoke an old link.

alter table public.leagues
  add column if not exists public_view_token text;

-- Backfill existing leagues. A dashed-free UUID gives a 32-char hex secret
-- (~122 bits) without depending on pgcrypto's gen_random_bytes.
update public.leagues
  set public_view_token = replace(gen_random_uuid()::text, '-', '')
  where public_view_token is null;

alter table public.leagues
  alter column public_view_token set not null;

-- New leagues get a token automatically, so app inserts never have to set it.
alter table public.leagues
  alter column public_view_token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists leagues_public_view_token_key
  on public.leagues (public_view_token);

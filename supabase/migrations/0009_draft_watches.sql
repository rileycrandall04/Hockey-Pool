-- 0009: draft stall notifications
--
-- Adds the plumbing for "ping me when a team has been on the clock
-- for N minutes without picking" alerts. The feature layers on top
-- of the existing web-push subscriptions added in 0006; no new push
-- infrastructure is required.
--
-- Three moving parts:
--
--   1. leagues.draft_on_clock_since
--        Timestamp set whenever the on-clock pointer moves. Populated
--        by /api/draft/start, /api/draft/pick, and the commissioner
--        rollback flow so the stall cron can compute elapsed time
--        without scanning draft_picks on every tick.
--
--   2. leagues.draft_stale_notified_for
--        The team id of the last pick we already sent a stall
--        notification for. When this equals draft_current_team we
--        skip re-sending; when the clock advances the column is
--        cleared so the NEXT team is eligible for a fresh alert.
--
--   3. draft_watches
--        Per-user opt-in list of leagues to watch. One row per
--        (user, league). stale_minutes defaults to 15 so users can
--        lower the threshold for faster-paced drafts without a
--        code change.

alter table public.leagues
  add column if not exists draft_on_clock_since timestamptz,
  add column if not exists draft_stale_notified_for uuid
    references public.teams(id) on delete set null;

create table if not exists public.draft_watches (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  league_id     uuid not null references public.leagues(id) on delete cascade,
  stale_minutes int not null default 15 check (stale_minutes > 0),
  created_at    timestamptz not null default now(),
  primary key (user_id, league_id)
);

create index if not exists draft_watches_league_idx
  on public.draft_watches (league_id);

alter table public.draft_watches enable row level security;

-- Users can read AND write only their own watches. The cron uses
-- the service-role key so it bypasses RLS when fanning out.
drop policy if exists "users read their own draft watches"
  on public.draft_watches;
create policy "users read their own draft watches"
  on public.draft_watches for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users insert their own draft watches"
  on public.draft_watches;
create policy "users insert their own draft watches"
  on public.draft_watches for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users update their own draft watches"
  on public.draft_watches;
create policy "users update their own draft watches"
  on public.draft_watches for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users delete their own draft watches"
  on public.draft_watches;
create policy "users delete their own draft watches"
  on public.draft_watches for delete
  to authenticated
  using (user_id = auth.uid());

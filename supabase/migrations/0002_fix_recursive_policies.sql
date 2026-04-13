-- 0002: fix infinite recursion in RLS policies
--
-- The v1 policies for `leagues` and `teams` reference each other (each
-- policy queries the other table inside an EXISTS subquery). When Postgres
-- evaluates those subqueries it applies the target table's RLS policy
-- again, which loops:
--
--    leagues.SELECT ─▶ teams.SELECT ─▶ leagues.SELECT ─▶ ...
--
-- Supabase raises "infinite recursion detected in policy for relation
-- leagues" the moment any SELECT hits either policy — including the
-- implicit SELECT that Supabase runs after INSERT when you ask for
-- `returning=representation`.
--
-- Fix: wrap the membership checks in SECURITY DEFINER helper functions.
-- A SECURITY DEFINER function runs with the owner's privileges and
-- therefore bypasses RLS on the tables it queries, breaking the cycle.
-- The helpers are scoped to `public` and only read the minimum needed.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.is_league_member(_league_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.teams
    where league_id = _league_id and owner_id = _user_id
  );
$$;

create or replace function public.is_league_commissioner(_league_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.leagues
    where id = _league_id and commissioner_id = _user_id
  );
$$;

grant execute on function public.is_league_member(uuid, uuid)       to authenticated;
grant execute on function public.is_league_commissioner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rewrite the recursive policies
-- ---------------------------------------------------------------------------

-- leagues.SELECT
drop policy if exists "members can read their leagues" on public.leagues;
create policy "members can read their leagues"
  on public.leagues for select
  to authenticated
  using (
    commissioner_id = auth.uid()
    or public.is_league_member(id, auth.uid())
  );

-- teams.SELECT
drop policy if exists "league members can read teams" on public.teams;
create policy "league members can read teams"
  on public.teams for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.is_league_commissioner(league_id, auth.uid())
    or public.is_league_member(league_id, auth.uid())
  );

-- teams.UPDATE
drop policy if exists "owner or commissioner can update team" on public.teams;
create policy "owner or commissioner can update team"
  on public.teams for update
  to authenticated
  using (
    owner_id = auth.uid()
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- teams.DELETE
drop policy if exists "owner or commissioner can delete team" on public.teams;
create policy "owner or commissioner can delete team"
  on public.teams for delete
  to authenticated
  using (
    owner_id = auth.uid()
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- draft_picks.SELECT
drop policy if exists "league members can read picks" on public.draft_picks;
create policy "league members can read picks"
  on public.draft_picks for select
  to authenticated
  using (
    public.is_league_member(league_id, auth.uid())
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- score_adjustments.SELECT
drop policy if exists "league members can read adjustments" on public.score_adjustments;
create policy "league members can read adjustments"
  on public.score_adjustments for select
  to authenticated
  using (
    public.is_league_member(league_id, auth.uid())
    or public.is_league_commissioner(league_id, auth.uid())
  );

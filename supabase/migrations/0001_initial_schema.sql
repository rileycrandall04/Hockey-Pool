-- Stanley Cup Pool - initial schema
-- Run with `supabase db push` or paste into the Supabase SQL editor.
--
-- This file is authored to be safely re-runnable: CREATE TABLE uses
-- IF NOT EXISTS, every policy is preceded by DROP POLICY IF EXISTS,
-- and all policies are created at the end of the file AFTER every
-- table exists (so a policy on `leagues` can reference `teams`).

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLES
-- ============================================================================

-- profiles (one row per auth.users) --------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  created_at timestamptz not null default now()
);

-- nhl_teams (the 16 playoff teams for a given season) -------------------
create table if not exists public.nhl_teams (
  id serial primary key,
  abbrev text not null unique,
  name text not null,
  conference text,
  logo_url text,
  eliminated boolean not null default false
);

-- players (NHL playoff player pool) -------------------------------------
create table if not exists public.players (
  id bigint primary key,
  full_name text not null,
  position text not null check (position in ('C','L','R','F','D','G')),
  nhl_team_id int references public.nhl_teams(id) on delete set null,
  jersey_number int,
  headshot_url text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists players_team_idx on public.players (nhl_team_id);
create index if not exists players_position_idx on public.players (position);

-- player_stats (cumulative playoff stats per player) --------------------
create table if not exists public.player_stats (
  player_id bigint primary key references public.players(id) on delete cascade,
  games_played int not null default 0,
  goals int not null default 0,
  assists int not null default 0,
  ot_goals int not null default 0,
  -- fantasy_points = goals + assists + (ot_goals * 2)
  --   An OT goal already counts in `goals`, so the +2 bonus makes it
  --   worth 3 total points.
  fantasy_points int generated always as (goals + assists + (ot_goals * 2)) stored,
  updated_at timestamptz not null default now()
);

create index if not exists player_stats_points_idx
  on public.player_stats (fantasy_points desc);

-- leagues ----------------------------------------------------------------
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season text not null default '2025-26',
  commissioner_id uuid not null references public.profiles(id) on delete restrict,
  join_code text not null unique,
  roster_size int not null default 12,
  scoring_roster_size int not null default 10,
  required_defensemen int not null default 2,
  draft_status text not null default 'pending'
    check (draft_status in ('pending','in_progress','complete')),
  draft_type text not null default 'manual'
    check (draft_type in ('manual','auto')),
  draft_current_team uuid,
  draft_round int not null default 1,
  draft_started_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists leagues_commissioner_idx on public.leagues (commissioner_id);

-- teams (one per user per league) ---------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  draft_position int,
  created_at timestamptz not null default now(),
  unique (league_id, owner_id)
);

create index if not exists teams_league_idx on public.teams (league_id);
create index if not exists teams_owner_idx on public.teams (owner_id);

-- draft_picks (roster entries) ------------------------------------------
create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete restrict,
  round int not null,
  pick_number int not null,
  picked_at timestamptz not null default now(),
  unique (league_id, player_id),
  unique (league_id, pick_number)
);

create index if not exists draft_picks_team_idx on public.draft_picks (team_id);

-- score_adjustments (commissioner overrides) ----------------------------
create table if not exists public.score_adjustments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  player_id bigint references public.players(id) on delete set null,
  delta_points int not null,
  reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists score_adj_league_idx on public.score_adjustments (league_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-create a profile whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.nhl_teams         enable row level security;
alter table public.players           enable row level security;
alter table public.player_stats      enable row level security;
alter table public.leagues           enable row level security;
alter table public.teams             enable row level security;
alter table public.draft_picks       enable row level security;
alter table public.score_adjustments enable row level security;

-- ----- profiles ---------------------------------------------------------
drop policy if exists "profiles are readable by authenticated users" on public.profiles;
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- ----- nhl_teams / players / player_stats (all public-read) -------------
drop policy if exists "nhl teams are public" on public.nhl_teams;
create policy "nhl teams are public" on public.nhl_teams
  for select to authenticated using (true);

drop policy if exists "players are public" on public.players;
create policy "players are public" on public.players
  for select to authenticated using (true);

drop policy if exists "player stats are public" on public.player_stats;
create policy "player stats are public" on public.player_stats
  for select to authenticated using (true);

-- ----- leagues ----------------------------------------------------------
drop policy if exists "members can read their leagues" on public.leagues;
create policy "members can read their leagues"
  on public.leagues for select
  to authenticated
  using (
    commissioner_id = auth.uid()
    or exists (
      select 1 from public.teams t
      where t.league_id = leagues.id and t.owner_id = auth.uid()
    )
  );

drop policy if exists "users can create leagues" on public.leagues;
create policy "users can create leagues"
  on public.leagues for insert
  to authenticated
  with check (commissioner_id = auth.uid());

drop policy if exists "commissioner can update league" on public.leagues;
create policy "commissioner can update league"
  on public.leagues for update
  to authenticated
  using (commissioner_id = auth.uid());

drop policy if exists "commissioner can delete league" on public.leagues;
create policy "commissioner can delete league"
  on public.leagues for delete
  to authenticated
  using (commissioner_id = auth.uid());

-- ----- teams ------------------------------------------------------------
drop policy if exists "league members can read teams" on public.teams;
create policy "league members can read teams"
  on public.teams for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.leagues l
      where l.id = teams.league_id and l.commissioner_id = auth.uid()
    )
    or exists (
      select 1 from public.teams t2
      where t2.league_id = teams.league_id and t2.owner_id = auth.uid()
    )
  );

drop policy if exists "users can create their own team" on public.teams;
create policy "users can create their own team"
  on public.teams for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "owner or commissioner can update team" on public.teams;
create policy "owner or commissioner can update team"
  on public.teams for update
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.leagues l
      where l.id = teams.league_id and l.commissioner_id = auth.uid()
    )
  );

drop policy if exists "owner or commissioner can delete team" on public.teams;
create policy "owner or commissioner can delete team"
  on public.teams for delete
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.leagues l
      where l.id = teams.league_id and l.commissioner_id = auth.uid()
    )
  );

-- ----- draft_picks ------------------------------------------------------
-- Writes go through server routes with the service-role key, so we only
-- grant SELECT to the authenticated role here.
drop policy if exists "league members can read picks" on public.draft_picks;
create policy "league members can read picks"
  on public.draft_picks for select
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.league_id = draft_picks.league_id and t.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.leagues l
      where l.id = draft_picks.league_id and l.commissioner_id = auth.uid()
    )
  );

-- ----- score_adjustments ------------------------------------------------
drop policy if exists "league members can read adjustments" on public.score_adjustments;
create policy "league members can read adjustments"
  on public.score_adjustments for select
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.league_id = score_adjustments.league_id and t.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.leagues l
      where l.id = score_adjustments.league_id and l.commissioner_id = auth.uid()
    )
  );

-- ============================================================================
-- VIEW: roster rows joined with player + stats
-- ============================================================================

create or replace view public.v_team_rosters as
select
  dp.league_id,
  dp.team_id,
  dp.player_id,
  dp.round,
  dp.pick_number,
  p.full_name,
  p.position,
  p.nhl_team_id,
  nt.abbrev as nhl_abbrev,
  coalesce(ps.goals, 0) as goals,
  coalesce(ps.assists, 0) as assists,
  coalesce(ps.ot_goals, 0) as ot_goals,
  coalesce(ps.fantasy_points, 0) as fantasy_points,
  coalesce(ps.games_played, 0) as games_played
from public.draft_picks dp
join public.players p on p.id = dp.player_id
left join public.nhl_teams nt on nt.id = p.nhl_team_id
left join public.player_stats ps on ps.player_id = dp.player_id;

grant select on public.v_team_rosters to authenticated;

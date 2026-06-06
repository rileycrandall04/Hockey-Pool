-- World Cup Draft Pool - initial schema
-- Run with `supabase db push` or paste into the Supabase SQL editor.
--
-- Re-runnable: CREATE TABLE uses IF NOT EXISTS, every policy is preceded by
-- DROP POLICY IF EXISTS, and policies are created at the END (after every
-- table exists) so a policy on `leagues` can reference `teams`.

create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLES
-- ============================================================================

-- profiles (one row per auth.users) -------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  created_at timestamptz not null default now()
);

-- countries (the 48-team field; the entire draft pool) -------------------
create table if not exists public.countries (
  id serial primary key,
  name text not null,
  code text not null unique,                  -- 3-letter FIFA/ISO code
  flag_url text,
  confederation text,                         -- UEFA, CONMEBOL, ...
  group_letter text,                          -- A..L
  fifa_rank int,                              -- frozen at kickoff; drives upsets
  eliminated boolean not null default false,
  external_id int unique                      -- API-Football team id
);

create index if not exists countries_group_idx on public.countries (group_letter);
create index if not exists countries_rank_idx on public.countries (fifa_rank);

-- players (lazily upserted from goal events for the Golden Boot race) ----
create table if not exists public.players (
  id serial primary key,
  country_id int references public.countries(id) on delete cascade,
  name text not null,
  external_id int unique                      -- API-Football player id
);

create index if not exists players_country_idx on public.players (country_id);

-- matches (104 fixtures: group stage + knockout) ------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('group','r32','r16','qf','sf','third','final')),
  matchday int,                               -- 1..3 for group; null for KO
  home_country_id int references public.countries(id) on delete set null,
  away_country_id int references public.countries(id) on delete set null,
  kickoff_utc timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','live','final')),
  home_goals int,                             -- regulation + ET (no PKs)
  away_goals int,
  went_to_shootout boolean not null default false,
  home_pens int,
  away_pens int,
  external_id int unique,                      -- API-Football fixture id
  updated_at timestamptz not null default now()
);

create index if not exists matches_stage_idx on public.matches (stage);
create index if not exists matches_kickoff_idx on public.matches (kickoff_utc);
create index if not exists matches_home_idx on public.matches (home_country_id);
create index if not exists matches_away_idx on public.matches (away_country_id);

-- match_goals (one row per goal: Golden Boot + audit trail) -------------
create table if not exists public.match_goals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  country_id int references public.countries(id) on delete set null,
  scorer_player_id int references public.players(id) on delete set null,
  minute int,
  type text not null default 'regular'
    check (type in ('regular','penalty','own_goal')),
  is_shootout boolean not null default false,
  external_id int unique,                      -- API-Football event id (if any)
  created_at timestamptz not null default now()
);

create index if not exists match_goals_match_idx on public.match_goals (match_id);
create index if not exists match_goals_scorer_idx on public.match_goals (scorer_player_id);

-- leagues ----------------------------------------------------------------
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season text not null default '2026',
  commissioner_id uuid not null references public.profiles(id) on delete restrict,
  join_code text not null unique,
  roster_size int not null default 4,         -- 12 owners x 4 = 48 teams
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

-- teams (one fantasy roster per user per league) ------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  draft_position int,
  over_under_guess int,                        -- secret; final tiebreaker
  created_at timestamptz not null default now(),
  unique (league_id, owner_id)
);

create index if not exists teams_league_idx on public.teams (league_id);
create index if not exists teams_owner_idx on public.teams (owner_id);

-- draft_picks (one row per drafted country) -----------------------------
create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  country_id int not null references public.countries(id) on delete restrict,
  round int not null,
  pick_number int not null,
  picked_at timestamptz not null default now(),
  unique (league_id, country_id),
  unique (league_id, pick_number)
);

create index if not exists draft_picks_team_idx on public.draft_picks (team_id);

-- score_adjustments (commissioner overrides) ----------------------------
create table if not exists public.score_adjustments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  country_id int references public.countries(id) on delete set null,
  delta_points numeric not null,              -- numeric: rules use -0.5 steps
  reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists score_adj_league_idx on public.score_adjustments (league_id);

-- golden_boot (per-league record of the awarded top scorer) -------------
-- Nullable until decided; the live leaderboard is derived from match_goals,
-- but the commissioner can lock in the official winner here.
create table if not exists public.golden_boot (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  player_id int references public.players(id) on delete set null,
  awarded_at timestamptz,
  awarded_by uuid references public.profiles(id)
);

-- ============================================================================
-- TRIGGERS + HELPER FUNCTIONS
-- ============================================================================

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

-- Membership helpers. SECURITY DEFINER to bypass RLS on their inner queries
-- and avoid recursive policy evaluation. STABLE so Postgres can cache them.
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

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.countries         enable row level security;
alter table public.players           enable row level security;
alter table public.matches           enable row level security;
alter table public.match_goals       enable row level security;
alter table public.leagues           enable row level security;
alter table public.teams             enable row level security;
alter table public.draft_picks       enable row level security;
alter table public.score_adjustments enable row level security;
alter table public.golden_boot       enable row level security;

-- ----- profiles ---------------------------------------------------------
drop policy if exists "profiles are readable by authenticated users" on public.profiles;
create policy "profiles are readable by authenticated users"
  on public.profiles for select to authenticated using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- ----- tournament data (all public-read to authenticated) --------------
drop policy if exists "countries are public" on public.countries;
create policy "countries are public" on public.countries
  for select to authenticated using (true);

drop policy if exists "players are public" on public.players;
create policy "players are public" on public.players
  for select to authenticated using (true);

drop policy if exists "matches are public" on public.matches;
create policy "matches are public" on public.matches
  for select to authenticated using (true);

drop policy if exists "match goals are public" on public.match_goals;
create policy "match goals are public" on public.match_goals
  for select to authenticated using (true);

-- ----- leagues ----------------------------------------------------------
drop policy if exists "members can read their leagues" on public.leagues;
create policy "members can read their leagues"
  on public.leagues for select to authenticated
  using (commissioner_id = auth.uid() or public.is_league_member(id, auth.uid()));

drop policy if exists "users can create leagues" on public.leagues;
create policy "users can create leagues"
  on public.leagues for insert to authenticated
  with check (commissioner_id = auth.uid());

drop policy if exists "commissioner can update league" on public.leagues;
create policy "commissioner can update league"
  on public.leagues for update to authenticated
  using (commissioner_id = auth.uid());

drop policy if exists "commissioner can delete league" on public.leagues;
create policy "commissioner can delete league"
  on public.leagues for delete to authenticated
  using (commissioner_id = auth.uid());

-- ----- teams ------------------------------------------------------------
drop policy if exists "league members can read teams" on public.teams;
create policy "league members can read teams"
  on public.teams for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_league_commissioner(league_id, auth.uid())
    or public.is_league_member(league_id, auth.uid())
  );

drop policy if exists "users can create their own team" on public.teams;
create policy "users can create their own team"
  on public.teams for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "owner or commissioner can update team" on public.teams;
create policy "owner or commissioner can update team"
  on public.teams for update to authenticated
  using (owner_id = auth.uid() or public.is_league_commissioner(league_id, auth.uid()));

drop policy if exists "owner or commissioner can delete team" on public.teams;
create policy "owner or commissioner can delete team"
  on public.teams for delete to authenticated
  using (owner_id = auth.uid() or public.is_league_commissioner(league_id, auth.uid()));

-- ----- draft_picks ------------------------------------------------------
-- Writes go through server routes with the service-role key; only SELECT here.
drop policy if exists "league members can read picks" on public.draft_picks;
create policy "league members can read picks"
  on public.draft_picks for select to authenticated
  using (
    public.is_league_member(league_id, auth.uid())
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- ----- score_adjustments ------------------------------------------------
drop policy if exists "league members can read adjustments" on public.score_adjustments;
create policy "league members can read adjustments"
  on public.score_adjustments for select to authenticated
  using (
    public.is_league_member(league_id, auth.uid())
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- ----- golden_boot ------------------------------------------------------
drop policy if exists "league members can read golden boot" on public.golden_boot;
create policy "league members can read golden boot"
  on public.golden_boot for select to authenticated
  using (
    public.is_league_member(league_id, auth.uid())
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- ============================================================================
-- VIEW: roster rows joined with their country
-- ============================================================================

create or replace view public.v_team_rosters as
select
  dp.league_id,
  dp.team_id,
  dp.country_id,
  dp.round,
  dp.pick_number,
  c.name      as country_name,
  c.code      as country_code,
  c.flag_url,
  c.group_letter,
  c.fifa_rank,
  c.eliminated
from public.draft_picks dp
join public.countries c on c.id = dp.country_id;

grant select on public.v_team_rosters to authenticated;

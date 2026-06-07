-- ============================================================================
-- World Cup Draft Pool — FULL SETUP (one-paste)
--
-- Convenience bundle of migrations 0001 + 0002 + 0003, in order. Paste the
-- whole thing into the Supabase SQL editor and Run once. Safe to re-run
-- (every statement is idempotent). The individual files under
-- supabase/migrations/ remain the canonical source.
-- ============================================================================


-- ############################################################################
-- # 0001_initial_schema.sql
-- ############################################################################

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


-- ####################################################################
-- # 0002_seed_countries.sql
-- ####################################################################

-- Seed the 48-team field for the draft pool.
--
-- IMPORTANT: this is PLACEHOLDER data for testing the app end-to-end now.
-- The team list, FIFA ranks, and group letters here are approximate and
-- NOT the official 2026 draw. Phase 4 (API-Football ingestion) will
-- upsert the real field, ranks, groups, and fixtures by `code`/external_id.
--
-- Re-runnable: ON CONFLICT (code) DO NOTHING. To re-seed fresh values,
-- `delete from public.countries;` first (only safe before any drafts).

insert into public.countries (name, code, confederation, group_letter, fifa_rank) values
  ('Argentina',     'ARG', 'CONMEBOL',  'A', 1),
  ('France',        'FRA', 'UEFA',      'B', 2),
  ('Spain',         'ESP', 'UEFA',      'C', 3),
  ('England',       'ENG', 'UEFA',      'D', 4),
  ('Brazil',        'BRA', 'CONMEBOL',  'E', 5),
  ('Portugal',      'POR', 'UEFA',      'F', 6),
  ('Netherlands',   'NED', 'UEFA',      'G', 7),
  ('Belgium',       'BEL', 'UEFA',      'H', 8),
  ('Italy',         'ITA', 'UEFA',      'I', 9),
  ('Germany',       'GER', 'UEFA',      'J', 10),
  ('Croatia',       'CRO', 'UEFA',      'K', 11),
  ('Morocco',       'MAR', 'CAF',       'L', 12),
  ('Colombia',      'COL', 'CONMEBOL',  'A', 13),
  ('Uruguay',       'URU', 'CONMEBOL',  'B', 14),
  ('USA',           'USA', 'CONCACAF',  'C', 15),
  ('Mexico',        'MEX', 'CONCACAF',  'D', 16),
  ('Switzerland',   'SUI', 'UEFA',      'E', 17),
  ('Senegal',       'SEN', 'CAF',       'F', 18),
  ('Japan',         'JPN', 'AFC',       'G', 19),
  ('Denmark',       'DEN', 'UEFA',      'H', 20),
  ('Iran',          'IRN', 'AFC',       'I', 21),
  ('Korea Republic','KOR', 'AFC',       'J', 22),
  ('Australia',     'AUS', 'AFC',       'K', 23),
  ('Ecuador',       'ECU', 'CONMEBOL',  'L', 24),
  ('Austria',       'AUT', 'UEFA',      'A', 25),
  ('Ukraine',       'UKR', 'UEFA',      'B', 26),
  ('Canada',        'CAN', 'CONCACAF',  'C', 27),
  ('Nigeria',       'NGA', 'CAF',       'D', 28),
  ('Egypt',         'EGY', 'CAF',       'E', 29),
  ('Poland',        'POL', 'UEFA',      'F', 30),
  ('Serbia',        'SRB', 'UEFA',      'G', 31),
  ('Wales',         'WAL', 'UEFA',      'H', 32),
  ('Peru',          'PER', 'CONMEBOL',  'I', 33),
  ('Tunisia',       'TUN', 'CAF',       'J', 34),
  ('Costa Rica',    'CRC', 'CONCACAF',  'K', 35),
  ('Ghana',         'GHA', 'CAF',       'L', 36),
  ('Cameroon',      'CMR', 'CAF',       'A', 37),
  ('Algeria',       'ALG', 'CAF',       'B', 38),
  ('Norway',        'NOR', 'UEFA',      'C', 39),
  ('Paraguay',      'PAR', 'CONMEBOL',  'D', 40),
  ('Ivory Coast',   'CIV', 'CAF',       'E', 41),
  ('Saudi Arabia',  'KSA', 'AFC',       'F', 42),
  ('Qatar',         'QAT', 'AFC',       'G', 43),
  ('Panama',        'PAN', 'CONCACAF',  'H', 44),
  ('New Zealand',   'NZL', 'OFC',       'I', 45),
  ('Jordan',        'JOR', 'AFC',       'J', 46),
  ('Uzbekistan',    'UZB', 'AFC',       'K', 47),
  ('Cape Verde',    'CPV', 'CAF',       'L', 48)
on conflict (code) do nothing;


-- ####################################################################
-- # 0003_ingestion.sql
-- ####################################################################

-- Phase 4 ingestion support.
--
-- 1. matches.locked — when a commissioner manually edits a result, lock it
--    so the API sync never overwrites their correction.
-- 2. top_scorers — a small cache of the live Golden Boot leaderboard,
--    refreshed from API-Football's /players/topscorers endpoint. Standings
--    award the +5 to the owner of the current leader's country.
--
-- Re-runnable.

alter table public.matches
  add column if not exists locked boolean not null default false;

create table if not exists public.top_scorers (
  player_external_id int primary key,   -- API-Football player id
  player_id int references public.players(id) on delete set null,
  player_name text not null,
  country_external_id int,              -- API-Football team id
  country_id int references public.countries(id) on delete set null,
  goals int not null default 0,
  assists int not null default 0,
  minutes int not null default 0,
  rank int,                             -- 1 = current leader
  updated_at timestamptz not null default now()
);

create index if not exists top_scorers_rank_idx on public.top_scorers (rank);

alter table public.top_scorers enable row level security;

drop policy if exists "top scorers are public" on public.top_scorers;
create policy "top scorers are public" on public.top_scorers
  for select to authenticated using (true);


-- ####################################################################
-- # 0004_admins_and_goals.sql
-- ####################################################################

-- Phase 5: admins + manual goal entry support.
--
-- 1. app_admins — users (besides the APP_OWNER_EMAIL) allowed to enter goals
--    and run global data tools. The app owner manages this list.
-- 2. match_goals.manual — distinguishes hand-entered goals from API-synced
--    ones, so the nightly events sync only replaces its own (non-manual) rows.
--
-- Re-runnable.

create table if not exists public.app_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.match_goals
  add column if not exists manual boolean not null default false;

-- Marks a final match whose goal events have already been pulled, so the
-- nightly events sync doesn't re-fetch 0-0 games forever. Cleared if you
-- want to force a re-pull.
alter table public.matches
  add column if not exists goals_synced boolean not null default false;

create index if not exists match_goals_country_idx on public.match_goals (country_id);

-- RLS: admin list is readable by any signed-in user (so the UI can show who
-- has access); writes go through service-role server actions.
alter table public.app_admins enable row level security;

drop policy if exists "app admins are readable" on public.app_admins;
create policy "app admins are readable" on public.app_admins
  for select to authenticated using (true);


-- ####################################################################
-- # 0005_country_overrides.sql
-- ####################################################################

-- Phase 5b: let the API drive team/group/rank data, with manual override.
--
-- When a commissioner/admin edits a country (name, group, or FIFA rank) in
-- the admin country editor, we set manual_override = true so the nightly
-- API sync stops touching that country's group/rank/name (it still backfills
-- external_id and flag).
--
-- Re-runnable.

alter table public.countries
  add column if not exists manual_override boolean not null default false;


-- ####################################################################
-- # 0006_match_conflicts.sql
-- ####################################################################

-- Sync vs manual reconciliation.
--
-- When a match is locked (hand-edited) and the API later reports a DIFFERENT
-- result, we don't overwrite the manual value — instead we record the
-- disagreement here so a commissioner can see it and decide which source is
-- right. One row per match; cleared automatically when the two agree again.
--
-- Re-runnable.

create table if not exists public.match_conflicts (
  match_id uuid primary key references public.matches(id) on delete cascade,
  manual_home_goals int,
  manual_away_goals int,
  manual_went_to_shootout boolean,
  manual_home_pens int,
  manual_away_pens int,
  api_home_goals int,
  api_away_goals int,
  api_went_to_shootout boolean,
  api_home_pens int,
  api_away_pens int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.match_conflicts enable row level security;

drop policy if exists "match conflicts are readable" on public.match_conflicts;
create policy "match conflicts are readable" on public.match_conflicts
  for select to authenticated using (true);

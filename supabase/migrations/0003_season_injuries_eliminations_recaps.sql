-- 0003: season stats, injury tracking, eliminated teams, daily recaps
--
-- Adds the columns + table needed for:
--   * Ranking the draft by regular-season points (instead of playoff
--     points which are zero pre-playoffs).
--   * Showing a red-cross injury badge next to players whose NHL
--     injury status is anything other than NULL.
--   * Filtering the draftable pool to exclude players whose team has
--     been eliminated from the playoffs.
--   * A daily ticker on the home page that lists the previous night's
--     final scores and goal scorers.

-- ---------------------------------------------------------------------------
-- 1. Season stats columns on players
-- ---------------------------------------------------------------------------
alter table public.players add column if not exists season_goals        int not null default 0;
alter table public.players add column if not exists season_assists      int not null default 0;
alter table public.players add column if not exists season_points       int not null default 0;
alter table public.players add column if not exists season_games_played int not null default 0;

create index if not exists players_season_points_idx
  on public.players (season_points desc);

-- ---------------------------------------------------------------------------
-- 2. Injury status on players
-- ---------------------------------------------------------------------------
-- NULL = healthy. Any non-null value (e.g. "Day to Day - Lower Body")
-- triggers the red-cross badge in the UI.
alter table public.players add column if not exists injury_status      text;
alter table public.players add column if not exists injury_description text;
alter table public.players add column if not exists injury_updated_at  timestamptz;

-- ---------------------------------------------------------------------------
-- 3. nhl_teams: track when a team was eliminated
-- ---------------------------------------------------------------------------
-- The `eliminated` boolean already exists from 0001. Add a timestamp so
-- the UI can show "eliminated 2 days ago" if we ever want to.
alter table public.nhl_teams add column if not exists eliminated_at timestamptz;
alter table public.nhl_teams add column if not exists updated_at    timestamptz default now();

-- ---------------------------------------------------------------------------
-- 4. Daily recaps for the home page ticker
-- ---------------------------------------------------------------------------
-- One row per finalized NHL game per day. The `scorers` JSONB array
-- holds rendered ticker entries:
--   [{ player_id, name, team, goals, assists }, ...]
-- The home page ticker reads the most recent date with rows.
create table if not exists public.daily_recaps (
  id uuid primary key default gen_random_uuid(),
  game_date date not null,
  game_id bigint not null,
  away_team_abbrev text not null,
  away_team_score int not null,
  home_team_abbrev text not null,
  home_team_score int not null,
  game_state text not null default 'OFF',
  was_overtime boolean not null default false,
  scorers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (game_id)
);

create index if not exists daily_recaps_date_idx
  on public.daily_recaps (game_date desc);

alter table public.daily_recaps enable row level security;

-- The home page ticker is shown to anonymous visitors, so we grant
-- SELECT to both anon and authenticated.
drop policy if exists "daily recaps are public" on public.daily_recaps;
create policy "daily recaps are public"
  on public.daily_recaps for select
  to anon, authenticated
  using (true);

-- The ticker also needs to read team info (logos / abbrevs) anonymously.
drop policy if exists "nhl teams are public" on public.nhl_teams;
create policy "nhl teams are public"
  on public.nhl_teams for select
  to anon, authenticated
  using (true);

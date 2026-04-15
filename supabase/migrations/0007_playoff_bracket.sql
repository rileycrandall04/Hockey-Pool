-- 0007: playoff bracket + upcoming games
--
-- Stores a shared (global, not per-league) snapshot of the Stanley
-- Cup playoff bracket so every league landing page can render the
-- same bracket visualization. Populated by the nightly stats cron
-- from the NHL public API:
--
--   /v1/playoff-bracket/{year}                           → series list
--   /v1/schedule/playoff-series/{season}/{seriesLetter}  → per-series games
--
-- Two tables:
--
--   playoff_series  one row per series (A through to the final). Tracks
--                   the two seeded teams, the current series score,
--                   and the round / sort order used to lay out the
--                   bracket on the page.
--
--   playoff_games   one row per game in every series. Holds the date,
--                   start time, venue, away/home abbrevs, scores, game
--                   state, and the TV broadcast networks as a JSONB
--                   array so we can show broadcast info without a
--                   second table.
--
-- Both tables are PUBLIC-read: the bracket is not league-specific and
-- we want the landing page to render without an extra auth hop.
-- Writes always go through the cron route with the service-role key.

-- ---------------------------------------------------------------------------
-- 1. Playoff series
-- ---------------------------------------------------------------------------
create table if not exists public.playoff_series (
  series_letter    text primary key,      -- "A".."P" per the NHL bracket
  season           text not null,         -- "20242025"
  round            int not null,          -- 1 = first round .. 4 = final
  series_title     text,                  -- e.g. "First Round"
  series_abbrev    text,                  -- e.g. "A1"
  top_seed_abbrev  text,
  top_seed_name    text,
  top_seed_logo    text,
  top_seed_wins    int not null default 0,
  bottom_seed_abbrev text,
  bottom_seed_name text,
  bottom_seed_logo text,
  bottom_seed_wins int not null default 0,
  winning_team_abbrev text,               -- null until a team clinches
  needed_to_win    int not null default 4,
  sort_order       int not null default 0, -- stable ordering for the UI
  updated_at       timestamptz not null default now()
);

create index if not exists playoff_series_round_idx
  on public.playoff_series (round, sort_order);

-- ---------------------------------------------------------------------------
-- 2. Playoff games
-- ---------------------------------------------------------------------------
create table if not exists public.playoff_games (
  game_id         bigint primary key,     -- NHL game id
  series_letter   text not null references public.playoff_series(series_letter) on delete cascade,
  game_number     int,                    -- 1..7 within the series
  start_time_utc  timestamptz,            -- null if not yet scheduled
  game_date       date,                   -- easier to group by day in UI
  venue           text,
  away_abbrev     text,
  home_abbrev     text,
  away_score      int,
  home_score      int,
  game_state      text,                   -- "FUT", "PRE", "LIVE", "FINAL", "OFF"
  -- tv_broadcasts is an array of { network, market, countryCode }
  -- records, e.g. [{"network":"SN","market":"N","countryCode":"CA"}, ...]
  tv_broadcasts   jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now()
);

create index if not exists playoff_games_series_idx
  on public.playoff_games (series_letter, game_number);
create index if not exists playoff_games_start_idx
  on public.playoff_games (start_time_utc);

-- ---------------------------------------------------------------------------
-- 3. RLS: public-read, service-role-only writes
-- ---------------------------------------------------------------------------
alter table public.playoff_series enable row level security;
alter table public.playoff_games  enable row level security;

drop policy if exists "playoff series are public" on public.playoff_series;
create policy "playoff series are public"
  on public.playoff_series for select
  to anon, authenticated
  using (true);

drop policy if exists "playoff games are public" on public.playoff_games;
create policy "playoff games are public"
  on public.playoff_games for select
  to anon, authenticated
  using (true);

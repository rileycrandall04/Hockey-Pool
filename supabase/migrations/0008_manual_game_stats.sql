-- 0008: manual per-game player stats overlay
--
-- Stores app-owner-entered per-game goal/assist/OT corrections when
-- the nightly data pull is incomplete or wrong. Each row is keyed by
-- (game_id, player_id) with absolute values; the save handler
-- computes the delta against the previous row and applies it to the
-- cumulative player_stats totals, so manual edits flow into standings
-- automatically.
--
-- NOT a replacement for the nightly cron — it's a manual overlay.
-- Rows here add to whatever the cron has already written into
-- player_stats. For correcting wrong cron-attributed stats (not
-- missing ones), use the per-player absolute editor on
-- /players/[id].
--
-- The editor lives on /games/[gameId]/edit, reached by tapping any
-- game tile in the home-page ticker.

create table if not exists public.manual_game_stats (
  id          uuid primary key default gen_random_uuid(),
  game_id     bigint not null,
  player_id   bigint not null references public.players(id) on delete cascade,
  goals       int not null default 0 check (goals >= 0),
  assists     int not null default 0 check (assists >= 0),
  -- ot_goals is a subset of goals (an OT goal is also a regular
  -- goal) so the check keeps the data model consistent with the
  -- cron's fetchGameStats parser.
  ot_goals    int not null default 0 check (ot_goals >= 0 and ot_goals <= goals),
  entered_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (game_id, player_id)
);

create index if not exists manual_game_stats_game_idx
  on public.manual_game_stats (game_id);
create index if not exists manual_game_stats_player_idx
  on public.manual_game_stats (player_id);

alter table public.manual_game_stats enable row level security;

-- Reads are available to every signed-in user so the edit page can
-- list existing entries without a service-client round trip. Writes
-- are service-role only via the game edit server actions.
drop policy if exists "manual game stats are readable"
  on public.manual_game_stats;
create policy "manual game stats are readable"
  on public.manual_game_stats for select
  to authenticated
  using (true);

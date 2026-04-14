-- 0004: per-league commissioner injury overrides
--
-- Today the players table has a single global injury_status column
-- maintained by the nightly NHL feed sync. When a commissioner manually
-- flagged a player as injured it overwrote that global value, which
-- meant their flag bled into every other league rostering the player.
--
-- Move commissioner overrides into a per-league table:
--   league_player_injuries(league_id, player_id, status, ...)
--
-- The v_team_rosters view is recreated to LEFT JOIN the override and
-- coalesce(override, global) so the standings/teams/team-page UIs
-- automatically prefer the override when present and fall back to the
-- NHL-feed global otherwise.

create table if not exists public.league_player_injuries (
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  injury_status text not null,
  injury_description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, player_id)
);

create index if not exists league_player_injuries_league_idx
  on public.league_player_injuries (league_id);

alter table public.league_player_injuries enable row level security;

drop policy if exists "league members can read injury overrides"
  on public.league_player_injuries;
create policy "league members can read injury overrides"
  on public.league_player_injuries for select
  to authenticated
  using (
    public.is_league_member(league_id, auth.uid())
    or public.is_league_commissioner(league_id, auth.uid())
  );

-- Writes go through server actions with the service-role key, so we
-- intentionally do NOT grant insert/update/delete here.

-- ---------------------------------------------------------------------------
-- Recreate v_team_rosters with the per-league override LEFT JOIN.
-- The scoring/standings/teams/team-page UIs all read from this view.
-- ---------------------------------------------------------------------------
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
  coalesce(lpi.injury_status, p.injury_status)             as injury_status,
  coalesce(lpi.injury_description, p.injury_description)   as injury_description,
  coalesce(ps.goals, 0)          as goals,
  coalesce(ps.assists, 0)        as assists,
  coalesce(ps.ot_goals, 0)       as ot_goals,
  coalesce(ps.fantasy_points, 0) as fantasy_points,
  coalesce(ps.games_played, 0)   as games_played
from public.draft_picks dp
join public.players p   on p.id = dp.player_id
left join public.nhl_teams nt   on nt.id = p.nhl_team_id
left join public.player_stats ps on ps.player_id = dp.player_id
left join public.league_player_injuries lpi
  on lpi.league_id = dp.league_id and lpi.player_id = dp.player_id;

grant select on public.v_team_rosters to authenticated;

-- Add logo_url to the v_team_rosters view so standings pages can
-- show NHL team logos next to player names.
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
  nt.logo_url as nhl_logo,
  coalesce(ps.goals, 0) as goals,
  coalesce(ps.assists, 0) as assists,
  coalesce(ps.ot_goals, 0) as ot_goals,
  coalesce(ps.fantasy_points, 0) as fantasy_points,
  coalesce(ps.games_played, 0) as games_played
from public.draft_picks dp
join public.players p on p.id = dp.player_id
left join public.nhl_teams nt on nt.id = p.nhl_team_id
left join public.player_stats ps on ps.player_id = dp.player_id;

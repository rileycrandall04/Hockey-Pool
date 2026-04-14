import { createServiceClient } from "./supabase/server";
import {
  fetchAllTeams,
  fetchTeamRoster,
  fetchTeamSeasonStats,
  currentSeason,
} from "./nhl-api";

/**
 * Idempotently upsert NHL teams + their current rosters into Supabase.
 *
 * Called from:
 *   - /api/cron/sync-players  (CRON_SECRET-authenticated)
 *   - /api/admin/seed         (first-time setup from the dashboard)
 *
 * If `abbrevs` is supplied we narrow to just those teams (useful once
 * the playoff field is set). Otherwise we sync every current NHL team.
 */
export async function seedPlayers(abbrevs?: string[]) {
  const svc = createServiceClient();

  // 1. Upsert teams.
  const allTeams = await fetchAllTeams();
  const teamsToInsert =
    abbrevs && abbrevs.length > 0
      ? allTeams.filter((t) => abbrevs.includes(t.abbrev))
      : allTeams;

  for (const t of teamsToInsert) {
    await svc.from("nhl_teams").upsert(
      {
        abbrev: t.abbrev,
        name: t.name,
        conference: t.conference,
        logo_url: t.logo_url,
      },
      { onConflict: "abbrev" },
    );
  }

  // 2. Reload so we know the numeric ids we assigned.
  const { data: teamRows } = await svc.from("nhl_teams").select("id, abbrev");
  const teamIdByAbbrev = new Map<string, number>(
    (teamRows ?? []).map((r) => [r.abbrev, r.id]),
  );

  // 3. For each team, pull roster + season stats and upsert players.
  const season = currentSeason();
  let totalPlayers = 0;
  for (const t of teamsToInsert) {
    const [roster, seasonStats] = await Promise.all([
      fetchTeamRoster(t.abbrev),
      fetchTeamSeasonStats(t.abbrev, season),
    ]);
    const teamId = teamIdByAbbrev.get(t.abbrev);
    if (!teamId) continue;

    const seasonByPlayer = new Map(seasonStats.map((s) => [s.playerId, s]));

    const rows = roster.map((p) => {
      const s = seasonByPlayer.get(p.id);
      return {
        id: p.id,
        full_name: p.full_name,
        position: p.position,
        nhl_team_id: teamId,
        jersey_number: p.jersey_number,
        headshot_url: p.headshot_url,
        active: true,
        season_goals: s?.goals ?? 0,
        season_assists: s?.assists ?? 0,
        season_points: s?.points ?? 0,
        season_games_played: s?.gamesPlayed ?? 0,
        updated_at: new Date().toISOString(),
      };
    });
    if (rows.length === 0) continue;

    await svc.from("players").upsert(rows, { onConflict: "id" });

    // Ensure a player_stats row exists so the view has zeroes to join on.
    await svc.from("player_stats").upsert(
      rows.map((r) => ({
        player_id: r.id,
        goals: 0,
        assists: 0,
        ot_goals: 0,
        games_played: 0,
      })),
      { onConflict: "player_id", ignoreDuplicates: true },
    );

    totalPlayers += rows.length;
  }

  return { teams: teamsToInsert.length, players: totalPlayers };
}

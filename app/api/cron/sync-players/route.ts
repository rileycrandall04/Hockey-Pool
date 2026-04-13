import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchAllTeams,
  fetchTeamRoster,
} from "@/lib/nhl-api";

export const dynamic = "force-dynamic";

/**
 * Seed / refresh the playoff player pool.
 *
 * Body (optional): { abbrevs: ["TOR","EDM",...] } — the list of qualifying
 * playoff teams to pull rosters for. If omitted we pull ALL current teams
 * so this can also be run pre-season to pre-populate the draftable pool.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedAbbrevs: string[] | undefined = body.abbrevs;

  const svc = createServiceClient();

  // 1. Upsert teams.
  const allTeams = await fetchAllTeams();
  const teamsToInsert =
    requestedAbbrevs && requestedAbbrevs.length > 0
      ? allTeams.filter((t) => requestedAbbrevs.includes(t.abbrev))
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

  // 2. Refresh teams lookup so we know the numeric ids we assigned.
  const { data: teamRows } = await svc
    .from("nhl_teams")
    .select("id, abbrev");
  const teamIdByAbbrev = new Map<string, number>(
    (teamRows ?? []).map((r) => [r.abbrev, r.id]),
  );

  // 3. For each team, pull its roster and upsert players.
  let totalPlayers = 0;
  for (const t of teamsToInsert) {
    const roster = await fetchTeamRoster(t.abbrev);
    const teamId = teamIdByAbbrev.get(t.abbrev);
    if (!teamId) continue;

    const rows = roster.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      position: p.position,
      nhl_team_id: teamId,
      jersey_number: p.jersey_number,
      headshot_url: p.headshot_url,
      active: true,
      updated_at: new Date().toISOString(),
    }));
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

  return NextResponse.json({
    ok: true,
    teams: teamsToInsert.length,
    players: totalPlayers,
  });
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return (
    auth === `Bearer ${secret}` ||
    header === secret
  );
}

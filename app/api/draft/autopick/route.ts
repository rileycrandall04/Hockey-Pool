import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { teamOnTheClock } from "@/lib/draft";
import type { Team } from "@/lib/types";

/**
 * Auto-pick the best available player (by playoff fantasy points) for the
 * team that is currently on the clock.
 *
 * Called by the draft UI when a user clicks "Auto-pick" on their turn, and
 * by the commissioner to unstick an AFK drafter. Can also be reused for
 * a fully automated draft by looping this endpoint.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    league_id?: string;
    team_id?: string;
  };
  const { league_id, team_id } = body;
  if (!league_id || !team_id) {
    return NextResponse.json(
      { error: "league_id and team_id required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  const { data: league } = await svc
    .from("leagues")
    .select("*")
    .eq("id", league_id)
    .single();
  if (!league || league.draft_status !== "in_progress") {
    return NextResponse.json(
      { error: "Draft is not in progress" },
      { status: 400 },
    );
  }

  const { data: team } = await svc
    .from("teams")
    .select("*")
    .eq("id", team_id)
    .single();
  if (!team || team.league_id !== league_id) {
    return NextResponse.json({ error: "Team not in league" }, { status: 400 });
  }
  const isCommissioner = league.commissioner_id === user.id;
  if (!isCommissioner && team.owner_id !== user.id) {
    return NextResponse.json({ error: "Not your team" }, { status: 403 });
  }

  // Enforce snake order.
  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", league_id)
    .order("draft_position", { ascending: true, nullsFirst: false });
  const { data: existingPicks } = await svc
    .from("draft_picks")
    .select("player_id")
    .eq("league_id", league_id);
  const picked = new Set((existingPicks ?? []).map((p) => p.player_id));
  const pickIndex = existingPicks?.length ?? 0;
  const onClock = teamOnTheClock((teams ?? []) as Team[], pickIndex);
  if (onClock.id !== team_id) {
    return NextResponse.json(
      { error: `It's ${onClock.name}'s pick` },
      { status: 400 },
    );
  }

  // Determine D gap: if the picking team will need D to satisfy the
  // required_defensemen rule and can't reasonably get them later, prefer
  // a defenseman. Simple heuristic: once a team has more picks remaining
  // than they need to reach the D minimum, just go BPA; otherwise force D.
  const { data: teamPicks } = await svc
    .from("draft_picks")
    .select("player_id, players(position)")
    .eq("team_id", team_id);

  const currentD = (teamPicks ?? []).filter(
    (p) => (p.players as unknown as { position: string } | null)?.position === "D",
  ).length;
  const remainingPicksForTeam =
    league.roster_size - (teamPicks?.length ?? 0);
  const dNeeded = Math.max(league.required_defensemen - currentD, 0);
  const forceD = dNeeded >= remainingPicksForTeam;

  // Best-available lookup. Rank by playoff points if any have been
  // accumulated, otherwise fall back to regular-season points.
  let query = svc
    .from("players")
    .select(
      "id, position, season_points, nhl_teams!inner(eliminated), player_stats(fantasy_points)",
    )
    .eq("active", true)
    .eq("nhl_teams.eliminated", false)
    .limit(100);
  if (forceD) {
    query = query.eq("position", "D");
  }
  const { data: candidates } = await query;

  const ranked = (candidates ?? [])
    .filter((c) => !picked.has(c.id as number))
    .map((c) => {
      const statRow = Array.isArray(c.player_stats)
        ? c.player_stats[0]
        : c.player_stats;
      const playoff =
        (statRow as { fantasy_points: number } | null)?.fantasy_points ?? 0;
      const season = (c.season_points as number | null) ?? 0;
      return {
        id: c.id as number,
        position: c.position as string,
        // Use playoff points if we have any; otherwise use season points.
        rank: playoff > 0 ? playoff * 1000 : season,
      };
    })
    .sort((a, b) => b.rank - a.rank);

  if (ranked.length === 0) {
    return NextResponse.json(
      { error: "No eligible players left" },
      { status: 400 },
    );
  }

  // Delegate the insert to /api/draft/pick so snake logic stays in one place.
  const origin = new URL(request.url).origin;
  const res = await fetch(`${origin}/api/draft/pick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({
      league_id,
      team_id,
      player_id: ranked[0].id,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(json, { status: res.status });
  }
  // json already contains { ok, round, pick, inserted } — forward it.
  return NextResponse.json({ player_id: ranked[0].id, ...json });
}

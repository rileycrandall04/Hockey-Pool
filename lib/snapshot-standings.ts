import { createServiceClient } from "./supabase/server";
import { scoreTeam } from "./scoring";
import type { RosterEntry } from "./types";

export interface SnapshotResult {
  leagues: number;
  teams: number;
  duration_ms: number;
}

export interface OvernightDelta {
  delta_rank: number; // positive = moved up in the standings
  delta_points: number; // overnight points gained
  rank_from: number;
  rank_to: number;
  points_from: number;
  points_to: number;
}

/**
 * Resolve today's date in Eastern time as YYYY-MM-DD.
 * Shared with the cron's yesterdayEasternISO helper.
 */
function todayEasternISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Write a standings snapshot row per team per league.
 *
 * Runs after the nightly stats update inside the cron. One snapshot
 * per day per team; re-running the cron on the same calendar date
 * upserts the same (snapshot_date, team_id) row rather than creating
 * a duplicate (the primary key forces this).
 *
 * Uses the same scoring/adjustment logic as the standings page so
 * the snapshot total matches what users actually see.
 */
export async function snapshotAllLeagues(): Promise<SnapshotResult> {
  const start = Date.now();
  const svc = createServiceClient();
  const snapshotDate = todayEasternISO();

  const { data: leagues } = await svc
    .from("leagues")
    .select("id, roster_size, scoring_roster_size, required_defensemen");

  if (!leagues || leagues.length === 0) {
    return { leagues: 0, teams: 0, duration_ms: Date.now() - start };
  }

  let totalTeams = 0;
  for (const league of leagues) {
    const { data: teams } = await svc
      .from("teams")
      .select("id")
      .eq("league_id", league.id);
    if (!teams || teams.length === 0) continue;

    const { data: rosterRows } = await svc
      .from("v_team_rosters")
      .select("*")
      .eq("league_id", league.id);

    const { data: adjustments } = await svc
      .from("score_adjustments")
      .select("team_id, delta_points")
      .eq("league_id", league.id);

    const adjByTeam = new Map<string, number>();
    for (const a of adjustments ?? []) {
      adjByTeam.set(
        a.team_id ?? "",
        (adjByTeam.get(a.team_id ?? "") ?? 0) + a.delta_points,
      );
    }

    const rosterByTeam = new Map<string, RosterEntry[]>();
    for (const row of (rosterRows as RosterEntry[] | null) ?? []) {
      const arr = rosterByTeam.get(row.team_id) ?? [];
      arr.push(row);
      rosterByTeam.set(row.team_id, arr);
    }

    const teamTotals = teams.map((t) => {
      const roster = rosterByTeam.get(t.id as string) ?? [];
      const scored = scoreTeam(roster, {
        rosterSize: league.roster_size as number,
        scoringRosterSize: league.scoring_roster_size as number,
        requiredDefensemen: league.required_defensemen as number,
      });
      const adj = adjByTeam.get(t.id as string) ?? 0;
      return {
        team_id: t.id as string,
        total: scored.totalPoints + adj,
      };
    });

    teamTotals.sort((a, b) => b.total - a.total);

    const rows = teamTotals.map((t, i) => ({
      league_id: league.id as string,
      team_id: t.team_id,
      snapshot_date: snapshotDate,
      total_points: t.total,
      rank: i + 1,
    }));

    const { error } = await svc
      .from("team_standings_snapshots")
      .upsert(rows, { onConflict: "snapshot_date,team_id" });
    if (!error) totalTeams += rows.length;
  }

  return {
    leagues: leagues.length,
    teams: totalTeams,
    duration_ms: Date.now() - start,
  };
}

/**
 * Compute overnight deltas for a single league.
 *
 * Returns a Map keyed by team_id whose value describes how that
 * team's rank + total_points changed between the two most recent
 * snapshot dates. Returns null if there's fewer than 2 snapshots
 * (i.e., we don't have anything to compare "overnight" against yet).
 */
export async function getOvernightDeltas(
  leagueId: string,
): Promise<{
  deltas: Map<string, OvernightDelta>;
  leagueAvgDeltaPoints: number;
} | null> {
  const svc = createServiceClient();

  const { data: dates } = await svc
    .from("team_standings_snapshots")
    .select("snapshot_date")
    .eq("league_id", leagueId)
    .order("snapshot_date", { ascending: false })
    .limit(50); // cheap extra headroom in case there are many repeats

  if (!dates || dates.length === 0) return null;

  // Collapse to distinct dates (the upsert means at most one per date
  // per team, but the SELECT returns one row per team per date so we
  // de-dupe in JS).
  const uniqueDates: string[] = [];
  for (const d of dates) {
    const s = d.snapshot_date as string;
    if (!uniqueDates.includes(s)) uniqueDates.push(s);
    if (uniqueDates.length === 2) break;
  }
  if (uniqueDates.length < 2) return null;

  const [today, yesterday] = uniqueDates;

  const { data: snapshots } = await svc
    .from("team_standings_snapshots")
    .select("team_id, snapshot_date, rank, total_points")
    .eq("league_id", leagueId)
    .in("snapshot_date", [today, yesterday]);

  const todayByTeam = new Map<
    string,
    { rank: number; total_points: number }
  >();
  const yesterdayByTeam = new Map<
    string,
    { rank: number; total_points: number }
  >();
  for (const s of snapshots ?? []) {
    const bucket =
      s.snapshot_date === today ? todayByTeam : yesterdayByTeam;
    bucket.set(s.team_id as string, {
      rank: s.rank as number,
      total_points: s.total_points as number,
    });
  }

  const deltas = new Map<string, OvernightDelta>();
  let deltaSum = 0;
  let deltaCount = 0;
  for (const [teamId, t] of todayByTeam) {
    const y = yesterdayByTeam.get(teamId);
    if (!y) continue;
    const deltaPoints = t.total_points - y.total_points;
    deltas.set(teamId, {
      delta_rank: y.rank - t.rank,
      delta_points: deltaPoints,
      rank_from: y.rank,
      rank_to: t.rank,
      points_from: y.total_points,
      points_to: t.total_points,
    });
    deltaSum += deltaPoints;
    deltaCount += 1;
  }

  if (deltas.size === 0) return null;

  const leagueAvgDeltaPoints = deltaCount > 0 ? deltaSum / deltaCount : 0;

  return { deltas, leagueAvgDeltaPoints };
}

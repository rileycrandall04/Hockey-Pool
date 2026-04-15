import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchCompletedGamesOnDate,
  fetchGameStats,
  fetchGameRecap,
  fetchEliminatedTeams,
} from "@/lib/nhl-api";
import { syncInjuries } from "@/lib/sync-injuries";
import { snapshotAllLeagues } from "@/lib/snapshot-standings";
import { syncPlayoffBracket } from "@/lib/sync-bracket";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly stats + housekeeping ingestion.
 *
 * Runs daily at 06:00 America/New_York (10:00 UTC) via Vercel Cron.
 *
 * Six jobs in one route:
 *   1. Pull every finished NHL game from the previous date, aggregate
 *      per-player goals / assists / OT goals, and increment the totals
 *      in `player_stats`.
 *   2. Build a one-row-per-game `daily_recaps` entry for the home page
 *      ticker (final score + goal/assist scorers).
 *   3. Refresh team elimination status from the standings endpoint.
 *      Players on freshly-eliminated teams are set inactive so they
 *      drop out of the draftable pool. Already-drafted players are
 *      untouched.
 *   4. Best-effort refresh injury status for every active player on
 *      a playoff team. Injured players get a red-cross badge in the
 *      draft room.
 *   5. Snapshot each league's standings so the overnight up/down/fire
 *      indicators have a baseline to compare against.
 *   6. Refresh the Stanley Cup playoff bracket (series + per-series
 *      schedule with dates, start times, and TV broadcasts). Powers
 *      the bracket card on each league landing page.
 *
 * Body (optional):
 *   - date: "YYYY-MM-DD" to run for a specific date (default: yesterday ET)
 *   - skip_injuries: skip the per-player injury fetch (it's the slowest part)
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const date: string = body.date ?? yesterdayEasternISO();
  const skipInjuries: boolean = body.skip_injuries === true;

  const svc = createServiceClient();
  const summary = {
    ok: true,
    date,
    games: 0,
    stats_updated: 0,
    recaps_written: 0,
    eliminated: 0,
    injuries_checked: 0,
    snapshots_written: 0,
    bracket_series: 0,
    bracket_games: 0,
    bracket_errors: [] as string[],
  };

  // -------------------------------------------------------------------
  // 1 + 2. Stats and recaps from yesterday's games
  // -------------------------------------------------------------------
  const gameIds = await fetchCompletedGamesOnDate(date);
  summary.games = gameIds.length;

  const deltas = new Map<
    number,
    { goals: number; assists: number; ot_goals: number; games: number }
  >();

  for (const id of gameIds) {
    // Stats deltas (used to bump player_stats)
    try {
      const lines = await fetchGameStats(id);
      const seen = new Set<number>();
      for (const l of lines) {
        const row = deltas.get(l.playerId) ?? {
          goals: 0,
          assists: 0,
          ot_goals: 0,
          games: 0,
        };
        row.goals += l.goals;
        row.assists += l.assists;
        row.ot_goals += l.otGoals;
        if (!seen.has(l.playerId)) {
          row.games += 1;
          seen.add(l.playerId);
        }
        deltas.set(l.playerId, row);
      }
    } catch (err) {
      console.error("Failed to fetch game stats", id, err);
    }

    // Daily recap row (used by the home page ticker)
    try {
      const recap = await fetchGameRecap(id);
      if (recap) {
        const { error } = await svc.from("daily_recaps").upsert(
          {
            game_id: recap.gameId,
            game_date: date,
            game_state: recap.gameState,
            away_team_abbrev: recap.awayAbbrev,
            away_team_score: recap.awayScore,
            home_team_abbrev: recap.homeAbbrev,
            home_team_score: recap.homeScore,
            was_overtime: recap.wasOvertime,
            scorers: recap.scorers,
          },
          { onConflict: "game_id" },
        );
        if (!error) summary.recaps_written += 1;
      }
    } catch (err) {
      console.error("Failed to fetch game recap", id, err);
    }
  }

  // Apply player_stats deltas in one batch
  const playerIds = [...deltas.keys()];
  if (playerIds.length > 0) {
    const { data: existing } = await svc
      .from("player_stats")
      .select("player_id, goals, assists, ot_goals, games_played")
      .in("player_id", playerIds);

    const existingById = new Map(
      (existing ?? []).map((r) => [r.player_id, r]),
    );

    const updates = playerIds.map((pid) => {
      const d = deltas.get(pid)!;
      const prev = existingById.get(pid) ?? {
        goals: 0,
        assists: 0,
        ot_goals: 0,
        games_played: 0,
      };
      return {
        player_id: pid,
        goals: prev.goals + d.goals,
        assists: prev.assists + d.assists,
        ot_goals: prev.ot_goals + d.ot_goals,
        games_played: prev.games_played + d.games,
        updated_at: new Date().toISOString(),
      };
    });

    const chunkSize = 500;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const { error } = await svc
        .from("player_stats")
        .upsert(chunk, { onConflict: "player_id" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    summary.stats_updated = updates.length;
  }

  // -------------------------------------------------------------------
  // 3. Elimination updates
  // -------------------------------------------------------------------
  try {
    const eliminatedAbbrevs = await fetchEliminatedTeams();
    if (eliminatedAbbrevs.size > 0) {
      // Look up nhl_team rows to get ids
      const { data: teamRows } = await svc
        .from("nhl_teams")
        .select("id, abbrev, eliminated")
        .in("abbrev", [...eliminatedAbbrevs]);

      const newlyEliminatedIds: number[] = [];
      for (const row of teamRows ?? []) {
        if (!row.eliminated) newlyEliminatedIds.push(row.id);
      }

      if (newlyEliminatedIds.length > 0) {
        await svc
          .from("nhl_teams")
          .update({
            eliminated: true,
            eliminated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in("id", newlyEliminatedIds);

        // Mark all undrafted players from those teams as inactive so the
        // draft pool no longer surfaces them. Drafted players are
        // untouched — points they already earned still count.
        await svc
          .from("players")
          .update({ active: false })
          .in("nhl_team_id", newlyEliminatedIds);

        summary.eliminated = newlyEliminatedIds.length;
      }
    }
  } catch (err) {
    console.error("Failed to refresh eliminations", err);
  }

  // -------------------------------------------------------------------
  // 4. Injury refresh (best-effort, slow). Reuses the same helper the
  // app-owner manual sync route calls.
  // -------------------------------------------------------------------
  if (!skipInjuries) {
    try {
      const injuryResult = await syncInjuries();
      summary.injuries_checked = injuryResult.checked;
    } catch (err) {
      console.error("Failed to refresh injuries", err);
    }
  }

  // -------------------------------------------------------------------
  // 5. Standings snapshot (one row per team per league per day).
  // Powers the overnight up/down/fire indicators on the standings
  // page. Runs last so it captures the just-updated totals.
  // -------------------------------------------------------------------
  try {
    const snapResult = await snapshotAllLeagues();
    summary.snapshots_written = snapResult.teams;
  } catch (err) {
    console.error("Failed to write standings snapshots", err);
  }

  // -------------------------------------------------------------------
  // 6. Playoff bracket + per-series schedules. Powers the bracket
  // card on each league landing page (matchups, series scores,
  // upcoming game dates/times, TV broadcasts).
  // -------------------------------------------------------------------
  try {
    const bracketResult = await syncPlayoffBracket();
    summary.bracket_series = bracketResult.series_upserted;
    summary.bracket_games = bracketResult.games_upserted;
    summary.bracket_errors = bracketResult.errors;
  } catch (err) {
    console.error("Failed to sync playoff bracket", err);
    summary.bracket_errors.push(
      err instanceof Error ? err.message : String(err),
    );
  }

  return NextResponse.json(summary);
}

// GET is accepted too because Vercel Cron sends GETs by default.
export async function GET(request: Request) {
  return POST(request);
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return auth === `Bearer ${secret}` || header === secret;
}

function yesterdayEasternISO(): string {
  // Format date as YYYY-MM-DD in America/New_York to match the NHL
  // schedule's notion of "yesterday".
  const now = new Date();
  now.setUTCHours(now.getUTCHours() - 24);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return ymd; // en-CA already returns YYYY-MM-DD
}

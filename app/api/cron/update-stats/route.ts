import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchCompletedGamesOnDate,
  fetchGameStats,
  fetchGameRecap,
  fetchEliminatedTeams,
  fetchPlayerInjury,
} from "@/lib/nhl-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly stats + housekeeping ingestion.
 *
 * Runs daily at 06:00 America/New_York (10:00 UTC) via Vercel Cron.
 *
 * Five jobs in one route:
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
  // 4. Injury refresh (best-effort, slow)
  // -------------------------------------------------------------------
  if (!skipInjuries) {
    try {
      // Only check active players (skip eliminated teams + already-inactive)
      const { data: activePlayers } = await svc
        .from("players")
        .select("id")
        .eq("active", true);

      const ids = (activePlayers ?? []).map((p) => p.id as number);
      // Cap to avoid blowing past maxDuration. 200 player landings ~= 30s.
      const chunkIds = ids.slice(0, 200);

      const injuryUpdates: Array<{
        id: number;
        injury_status: string | null;
        injury_description: string | null;
        injury_updated_at: string;
      }> = [];

      // Fan out 10 at a time
      const concurrency = 10;
      for (let i = 0; i < chunkIds.length; i += concurrency) {
        const batch = chunkIds.slice(i, i + concurrency);
        const results = await Promise.all(
          batch.map(async (id) => ({
            id,
            info: await fetchPlayerInjury(id),
          })),
        );
        for (const r of results) {
          injuryUpdates.push({
            id: r.id,
            injury_status: r.info.status,
            injury_description: r.info.description,
            injury_updated_at: new Date().toISOString(),
          });
        }
      }

      if (injuryUpdates.length > 0) {
        // Upsert is convenient but we only want to overwrite the injury
        // fields, not the rest of the player row. Run individual updates
        // for each player. Cheap enough at 200 rows.
        for (const u of injuryUpdates) {
          await svc
            .from("players")
            .update({
              injury_status: u.injury_status,
              injury_description: u.injury_description,
              injury_updated_at: u.injury_updated_at,
            })
            .eq("id", u.id);
        }
        summary.injuries_checked = injuryUpdates.length;
      }
    } catch (err) {
      console.error("Failed to refresh injuries", err);
    }
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

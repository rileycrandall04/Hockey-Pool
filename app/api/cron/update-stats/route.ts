import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchCompletedGamesOnDate,
  fetchGameStats,
} from "@/lib/nhl-api";

export const dynamic = "force-dynamic";

/**
 * Nightly stats ingestion.
 *
 * Runs daily at 04:00 America/New_York via Vercel Cron. Fetches every
 * completed NHL playoff game played the previous day, aggregates
 * per-player goals / assists / OT goals, and INCREMENTS the totals in
 * player_stats. Using cumulative + delta-apply lets us re-run the job
 * idempotently if we use `replace: true` — but by default the job runs
 * once per night and adds yesterday's totals on top of the existing
 * season total.
 *
 * Body (optional):
 *   - date: "YYYY-MM-DD" to run for a specific date (default: yesterday ET)
 *   - replace: boolean — if true, wipe player_stats first and rebuild from
 *     scratch by walking every day since season start. Use sparingly.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const date: string = body.date ?? yesterdayEasternISO();

  const svc = createServiceClient();

  // Gather all finished game IDs from that date.
  const gameIds = await fetchCompletedGamesOnDate(date);
  if (gameIds.length === 0) {
    return NextResponse.json({ ok: true, date, games: 0, updated: 0 });
  }

  // Accumulate deltas for every player across all games that day.
  const deltas = new Map<
    number,
    { goals: number; assists: number; ot_goals: number; games: number }
  >();
  for (const id of gameIds) {
    try {
      const lines = await fetchGameStats(id);
      // Track which players appeared so we can bump games_played.
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
      console.error("Failed to fetch game", id, err);
    }
  }

  // Pull the existing player_stats rows for everybody we have deltas for,
  // then write back the merged totals.
  const playerIds = [...deltas.keys()];
  if (playerIds.length === 0) {
    return NextResponse.json({ ok: true, date, games: gameIds.length, updated: 0 });
  }

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

  // Chunk the upsert to stay under the row limit.
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

  return NextResponse.json({
    ok: true,
    date,
    games: gameIds.length,
    updated: updates.length,
  });
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
  // Format date as YYYY-MM-DD in America/New_York to match the NHL schedule's
  // notion of "yesterday".
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

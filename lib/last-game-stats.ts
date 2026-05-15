import type { createServiceClient } from "@/lib/supabase/server";

export interface LastGameStat {
  player_id: number;
  game_id: number;
  game_date: string | null;
  away_abbrev: string | null;
  home_abbrev: string | null;
  goals: number;
  assists: number;
  ot_goals: number;
  fantasy_points: number;
}

/**
 * For each player id, return the most recent game in which they had
 * any recorded stats (the manual_game_stats row with the latest
 * playoff_games.game_date / start_time_utc). Used by the team page
 * and player card to surface "what did they do yesterday" without
 * scrolling through a full game log.
 *
 * Players with zero recorded games return nothing — callers should
 * treat missing entries as "no last game yet".
 */
export async function fetchLastGameStats(
  svc: ReturnType<typeof createServiceClient>,
  playerIds: number[],
): Promise<Map<number, LastGameStat>> {
  if (playerIds.length === 0) return new Map();

  const { data: rows } = await svc
    .from("manual_game_stats")
    .select("player_id, game_id, goals, assists, ot_goals")
    .in("player_id", playerIds);

  const gameIds = [...new Set((rows ?? []).map((r) => r.game_id))];
  if (gameIds.length === 0) return new Map();

  const { data: games } = await svc
    .from("playoff_games")
    .select("game_id, game_date, start_time_utc, away_abbrev, home_abbrev")
    .in("game_id", gameIds);

  const gameById = new Map<
    number,
    {
      game_id: number;
      game_date: string | null;
      start_time_utc: string | null;
      away_abbrev: string | null;
      home_abbrev: string | null;
    }
  >();
  for (const g of games ?? []) gameById.set(g.game_id, g);

  const dateKey = (g: typeof gameById extends Map<number, infer V> ? V : never) =>
    g.game_date ?? (g.start_time_utc ? g.start_time_utc.slice(0, 10) : "");

  const out = new Map<number, LastGameStat>();
  for (const r of rows ?? []) {
    const g = gameById.get(r.game_id);
    if (!g) continue;
    const d = dateKey(g);
    const existing = out.get(r.player_id);
    if (existing) {
      const prev =
        existing.game_date ?? "";
      if (d <= prev) continue;
    }
    out.set(r.player_id, {
      player_id: r.player_id,
      game_id: r.game_id,
      game_date: d || null,
      away_abbrev: g.away_abbrev,
      home_abbrev: g.home_abbrev,
      goals: r.goals,
      assists: r.assists,
      ot_goals: r.ot_goals,
      fantasy_points: r.goals + r.assists + 2 * r.ot_goals,
    });
  }
  return out;
}

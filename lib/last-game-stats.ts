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
 * playoff_games.game_date / start_time_utc). Used by the player card
 * to show "their last game stats" even if it was several days ago.
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

/**
 * Return each player's stat line from the LEAGUE-wide latest game
 * day — i.e. the most recent calendar date on which any playoff
 * game went FINAL/OFF. Players who didn't suit up on that date
 * aren't in the result.
 *
 * Differs from fetchLastGameStats: that helper picks the most recent
 * game PER PLAYER (could be days apart). This one anchors everyone
 * to the same date so a green "from last game" pill consistently
 * means "from the most recent slate," not "whenever they last
 * skated."
 *
 * The return value also includes `date` so callers can surface which
 * day's stats they're reading.
 */
export async function fetchPointsForLatestGameDay(
  svc: ReturnType<typeof createServiceClient>,
  playerIds: number[],
): Promise<{ date: string | null; byPlayer: Map<number, LastGameStat> }> {
  if (playerIds.length === 0) return { date: null, byPlayer: new Map() };

  // 1. Find the latest calendar date among completed playoff games.
  //    A FINAL or OFF state means the game actually finished — pre-
  //    scheduled FUT games on today's date shouldn't count as "the
  //    last game day" until they're played.
  const { data: finalGames } = await svc
    .from("playoff_games")
    .select(
      "game_id, game_date, start_time_utc, away_abbrev, home_abbrev",
    )
    .in("game_state", ["FINAL", "OFF"]);

  const dateKey = (g: {
    game_date: string | null;
    start_time_utc: string | null;
  }) => g.game_date ?? (g.start_time_utc ? g.start_time_utc.slice(0, 10) : "");

  let latestDate = "";
  for (const g of finalGames ?? []) {
    const d = dateKey(g);
    if (d > latestDate) latestDate = d;
  }
  if (!latestDate) return { date: null, byPlayer: new Map() };

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
  const latestGameIds: number[] = [];
  for (const g of finalGames ?? []) {
    gameById.set(g.game_id, g);
    if (dateKey(g) === latestDate) latestGameIds.push(g.game_id);
  }

  // 2. Fetch this league's players' stats on those games and roll
  //    up — handles the (rare in playoffs) case where a player has
  //    multiple rows for the same day.
  const { data: rows } = await svc
    .from("manual_game_stats")
    .select("player_id, game_id, goals, assists, ot_goals")
    .in("player_id", playerIds)
    .in("game_id", latestGameIds.length > 0 ? latestGameIds : [-1]);

  const byPlayer = new Map<number, LastGameStat>();
  for (const r of rows ?? []) {
    const g = gameById.get(r.game_id);
    if (!g) continue;
    const existing = byPlayer.get(r.player_id);
    if (existing) {
      existing.goals += r.goals;
      existing.assists += r.assists;
      existing.ot_goals += r.ot_goals;
      existing.fantasy_points =
        existing.goals + existing.assists + 2 * existing.ot_goals;
    } else {
      byPlayer.set(r.player_id, {
        player_id: r.player_id,
        game_id: r.game_id,
        game_date: latestDate,
        away_abbrev: g.away_abbrev,
        home_abbrev: g.home_abbrev,
        goals: r.goals,
        assists: r.assists,
        ot_goals: r.ot_goals,
        fantasy_points: r.goals + r.assists + 2 * r.ot_goals,
      });
    }
  }
  return { date: latestDate, byPlayer };
}


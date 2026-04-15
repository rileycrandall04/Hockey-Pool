import { createServiceClient } from "./supabase/server";
import {
  currentSeason,
  fetchPlayoffBracket,
  fetchPlayoffSeriesSchedule,
  playoffYearForSeason,
  type BracketGame,
  type BracketSeries,
} from "./nhl-api";

export interface BracketSyncResult {
  season: string;
  series_upserted: number;
  games_upserted: number;
  errors: string[];
}

/**
 * Refresh the shared Stanley Cup playoff bracket tables.
 *
 * Flow:
 *   1. Fetch the bracket for the current NHL season (derived from
 *      lib/nhl-api#currentSeason).
 *   2. Upsert one row per series into `playoff_series`, assigning a
 *      stable sort order so the UI can render the tree in a natural
 *      order (round first, then series letter within the round).
 *   3. For each series with a letter, fetch the per-series schedule
 *      and upsert every game row into `playoff_games` with the
 *      date, start time, venue, scores, state, and TV broadcasts.
 *
 * Best-effort: if a sub-fetch fails (network blip, shape drift) it's
 * recorded in `errors` and the rest of the sync continues. The caller
 * can surface errors in the cron response body.
 *
 * Returns counts so the cron summary can report what happened.
 */
export async function syncPlayoffBracket(): Promise<BracketSyncResult> {
  const svc = createServiceClient();
  const season = currentSeason();
  const year = playoffYearForSeason(season);
  const result: BracketSyncResult = {
    season,
    series_upserted: 0,
    games_upserted: 0,
    errors: [],
  };

  let bracket: BracketSeries[] = [];
  try {
    bracket = await fetchPlayoffBracket(year);
  } catch (err) {
    result.errors.push(
      `fetchPlayoffBracket(${year}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  if (bracket.length === 0) {
    // Pre-playoffs or API unavailable — nothing to write. We
    // intentionally don't clear existing rows here: if the API is
    // just temporarily down, we want the last-known-good bracket to
    // keep rendering.
    return result;
  }

  // Sort the bracket into a stable order: round ascending, then by
  // series letter. The sort_order column is what the UI uses to lay
  // out the tree, so we write it explicitly rather than relying on
  // insertion order.
  const sorted = [...bracket].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    return a.seriesLetter.localeCompare(b.seriesLetter);
  });

  // Drop any series that aren't in the fresh bracket. This purges
  // stale rows from a previous playoff year — the same series
  // letters (A, B, C...) are reused each season with different teams,
  // so the upsert would otherwise only overwrite the ones still
  // present in the new bracket. `playoff_games` rows cascade-delete
  // via the foreign key, so the old schedule goes with them.
  const freshLetters = new Set(sorted.map((s) => s.seriesLetter));
  const { data: existingRows } = await svc
    .from("playoff_series")
    .select("series_letter");
  const stale = (existingRows ?? [])
    .map((r) => r.series_letter as string)
    .filter((l) => !freshLetters.has(l));
  if (stale.length > 0) {
    const { error: purgeError } = await svc
      .from("playoff_series")
      .delete()
      .in("series_letter", stale);
    if (purgeError) {
      result.errors.push(`playoff_series purge: ${purgeError.message}`);
    }
  }

  const seriesRows = sorted.map((s, idx) => ({
    series_letter: s.seriesLetter,
    season,
    round: s.round,
    series_title: s.title,
    series_abbrev: s.abbrev,
    top_seed_abbrev: s.topSeedAbbrev,
    top_seed_name: s.topSeedName,
    top_seed_logo: s.topSeedLogo,
    top_seed_wins: s.topSeedWins,
    bottom_seed_abbrev: s.bottomSeedAbbrev,
    bottom_seed_name: s.bottomSeedName,
    bottom_seed_logo: s.bottomSeedLogo,
    bottom_seed_wins: s.bottomSeedWins,
    winning_team_abbrev: s.winningTeamAbbrev,
    needed_to_win: s.neededToWin,
    sort_order: idx,
    updated_at: new Date().toISOString(),
  }));

  const { error: seriesError } = await svc
    .from("playoff_series")
    .upsert(seriesRows, { onConflict: "series_letter" });
  if (seriesError) {
    result.errors.push(`playoff_series upsert: ${seriesError.message}`);
    return result;
  }
  result.series_upserted = seriesRows.length;

  // Pull games for each series. We do this sequentially to stay gentle
  // on the public NHL API; the full first round is only 8 series.
  for (const s of sorted) {
    if (!s.topSeedAbbrev || !s.bottomSeedAbbrev) {
      // Series doesn't have both teams set yet (e.g. the other side of
      // the bracket hasn't finished). Skip its schedule fetch.
      continue;
    }
    let games: BracketGame[] = [];
    try {
      games = await fetchPlayoffSeriesSchedule(season, s.seriesLetter);
    } catch (err) {
      result.errors.push(
        `series ${s.seriesLetter}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (games.length === 0) continue;

    // If the NHL API didn't give us a game_number, fall back to the
    // index within the series so the UI still has stable ordering.
    const rows = games.map((g, idx) => ({
      game_id: g.gameId,
      series_letter: s.seriesLetter,
      game_number: g.gameNumber ?? idx + 1,
      start_time_utc: g.startTimeUtc,
      game_date: g.gameDate,
      venue: g.venue,
      away_abbrev: g.awayAbbrev,
      home_abbrev: g.homeAbbrev,
      away_score: g.awayScore,
      home_score: g.homeScore,
      game_state: g.gameState,
      tv_broadcasts: g.tvBroadcasts,
      updated_at: new Date().toISOString(),
    }));

    const { error: gamesError } = await svc
      .from("playoff_games")
      .upsert(rows, { onConflict: "game_id" });
    if (gamesError) {
      result.errors.push(
        `playoff_games upsert (${s.seriesLetter}): ${gamesError.message}`,
      );
      continue;
    }
    result.games_upserted += rows.length;
  }

  return result;
}

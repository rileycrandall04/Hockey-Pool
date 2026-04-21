import type { createServiceClient } from "@/lib/supabase/server";

/**
 * Recompute a series' win totals from its FINAL games.
 *
 * Called after any write that could change a series' standing — marking
 * a game FINAL, editing scores via the bracket form, or saving stats
 * (since stat saves derive game scores from goal totals). Keeping all
 * three paths funnelled through here prevents the series record from
 * drifting out of sync with the underlying games.
 *
 * Games with both scores at 0 are treated as "no result yet" and
 * skipped so a freshly-FINAL'd 0-0 placeholder doesn't mis-tally.
 */
export async function recomputeSeriesWinsForGame(
  svc: ReturnType<typeof createServiceClient>,
  gameId: number,
): Promise<void> {
  const { data: game } = await svc
    .from("playoff_games")
    .select("series_letter")
    .eq("game_id", gameId)
    .single();
  if (!game) return;

  const { data: series } = await svc
    .from("playoff_series")
    .select("top_seed_abbrev, bottom_seed_abbrev, needed_to_win")
    .eq("series_letter", game.series_letter)
    .single();
  if (!series) return;

  const { data: finalGames } = await svc
    .from("playoff_games")
    .select("away_abbrev, home_abbrev, away_score, home_score")
    .eq("series_letter", game.series_letter)
    .eq("game_state", "FINAL");

  let topWins = 0;
  let bottomWins = 0;
  const topAbbrev = (series.top_seed_abbrev ?? "").toUpperCase();
  const bottomAbbrev = (series.bottom_seed_abbrev ?? "").toUpperCase();
  for (const g of finalGames ?? []) {
    if (g.away_score == null || g.home_score == null) continue;
    if (g.away_score === 0 && g.home_score === 0) continue;
    const awayWon = g.away_score > g.home_score;
    const winner = (awayWon ? g.away_abbrev : g.home_abbrev ?? "").toUpperCase();
    if (winner === topAbbrev) topWins++;
    else if (winner === bottomAbbrev) bottomWins++;
  }

  const winningTeam =
    topWins >= series.needed_to_win
      ? series.top_seed_abbrev
      : bottomWins >= series.needed_to_win
        ? series.bottom_seed_abbrev
        : null;

  await svc
    .from("playoff_series")
    .update({
      top_seed_wins: topWins,
      bottom_seed_wins: bottomWins,
      winning_team_abbrev: winningTeam,
      updated_at: new Date().toISOString(),
    })
    .eq("series_letter", game.series_letter);
}

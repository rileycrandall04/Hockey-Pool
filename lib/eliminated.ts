import type { PlayoffSeries } from "@/lib/types";

/**
 * A series is "finished" if either seed has reached `needed_to_win`
 * (typically 4) or the row already carries `winning_team_abbrev`.
 */
export function isSeriesFinished(s: {
  top_seed_wins: number;
  bottom_seed_wins: number;
  needed_to_win: number;
  winning_team_abbrev: string | null;
}): boolean {
  const needed = s.needed_to_win ?? 4;
  return (
    !!s.winning_team_abbrev ||
    s.top_seed_wins >= needed ||
    s.bottom_seed_wins >= needed
  );
}

/**
 * Set of `series_letter` values whose series is over. Use this to
 * filter games (Tonight's Games card, scoreboard, daily ticker) so
 * clinched matchups stop showing once the series ends.
 */
export function finishedSeriesLetters(
  series: PlayoffSeries[],
): Set<string> {
  const out = new Set<string>();
  for (const s of series) {
    if (isSeriesFinished(s)) out.add(s.series_letter);
  }
  return out;
}

/**
 * Filter helper used by every game-list view (Tonight's Games,
 * scoreboard, daily ticker). The rule is:
 *
 *   - Played games (FINAL/OFF) always stay, so the deciding game of
 *     a series is still visible on the night it's played.
 *   - Unplayed games (FUT/PRE/LIVE/null) drop out as soon as their
 *     series is clinched, so leftover Game 5/6/7 placeholders don't
 *     keep cluttering the page.
 */
export function shouldShowGame(
  game: { series_letter: string; game_state?: string | null },
  finishedLetters: Set<string>,
): boolean {
  const played =
    game.game_state === "FINAL" || game.game_state === "OFF";
  if (played) return true;
  return !finishedLetters.has(game.series_letter);
}

/**
 * Derive the set of NHL team abbrevs eliminated from the playoffs
 * directly from the `playoff_series` table. A team is considered
 * eliminated as soon as the OTHER seed in its series has reached
 * `needed_to_win` (typically 4) wins, OR when the series row
 * already carries a `winning_team_abbrev` pointing at the opponent.
 *
 * This is independent of `nhl_teams.eliminated`, which is only
 * refreshed by the nightly cron — using bracket state means the
 * UI can strike out players as soon as a series-clinching game is
 * marked Final, without waiting on the NHL API sync.
 */
export function eliminatedAbbrevsFromSeries(
  series: PlayoffSeries[],
): Set<string> {
  const out = new Set<string>();
  for (const s of series) {
    const needed = s.needed_to_win ?? 4;
    const top = s.top_seed_abbrev;
    const bottom = s.bottom_seed_abbrev;
    if (top && s.bottom_seed_wins >= needed) out.add(top);
    if (bottom && s.top_seed_wins >= needed) out.add(bottom);
    if (s.winning_team_abbrev) {
      if (top && s.winning_team_abbrev === bottom) out.add(top);
      else if (bottom && s.winning_team_abbrev === top) out.add(bottom);
    }
  }
  return out;
}

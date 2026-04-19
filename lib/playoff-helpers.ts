/**
 * Shared helpers for playoff game date matching.
 *
 * Many existing games have `game_date` set to null because they were
 * created before the auto-derive logic was added. These helpers fall
 * back to extracting the date from `start_time_utc` so that games
 * still show up on the correct day.
 */

/**
 * Resolve today's date in Eastern time as YYYY-MM-DD.
 */
export function todayEasternISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Get the effective date for a game, checking `game_date` first
 * and falling back to extracting the date portion from
 * `start_time_utc` in Eastern time.
 */
export function getGameDate(game: {
  game_date?: string | null;
  start_time_utc?: string | null;
}): string | null {
  if (game.game_date) return game.game_date;
  if (!game.start_time_utc) return null;
  const d = new Date(game.start_time_utc);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Check if a game falls on a specific date (YYYY-MM-DD).
 */
export function isGameOnDate(
  game: { game_date?: string | null; start_time_utc?: string | null },
  dateISO: string,
): boolean {
  return getGameDate(game) === dateISO;
}

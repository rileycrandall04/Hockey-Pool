/**
 * Compute the team "on the clock" for a given overall pick in a snake
 * draft. `teams` must be sorted by draft_position ASC; `pickIndex` is the
 * 0-based overall pick number. Generic so it works on any team-shaped row.
 */
export function teamOnTheClock<T>(teams: T[], pickIndex: number): T {
  const n = teams.length;
  if (n === 0) throw new Error("No teams in league");

  const round = Math.floor(pickIndex / n);
  const posInRound = pickIndex % n;
  const isReverseRound = round % 2 === 1; // snake

  const slot = isReverseRound ? n - 1 - posInRound : posInRound;
  return teams[slot];
}

/** (round, pick_number) for an overall pick index, both 1-based. */
export function pickMeta(pickIndex: number, teamsCount: number) {
  return {
    round: Math.floor(pickIndex / teamsCount) + 1,
    pick_number: pickIndex + 1,
  };
}

/** Fisher-Yates shuffle (used to randomize draft order). */
export function randomizeDraftOrder<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

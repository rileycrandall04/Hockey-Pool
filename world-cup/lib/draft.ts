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

/**
 * How many teams each owner drafts, given the number of owners. It's the
 * largest EVEN number of teams per owner that fits in the field — even keeps
 * the snake draft fair (each owner gets the same early/late pick balance), and
 * every owner gets the same count. With fewer owners, everyone drafts more.
 * The leftover (lowest-ranked) teams go undrafted.
 *
 *   12 owners -> 4 each (48 used)      9 owners -> 4 each (36 used, 12 unused)
 *    8 owners -> 6 each (48 used)      6 owners -> 8 each (48 used)
 *
 * Returns 0 if there are so many owners that not even 2 teams each fit.
 */
export function evenRosterSize(numTeams: number, totalCountries = 48): number {
  if (numTeams <= 0) return 0;
  let k = Math.floor(totalCountries / numTeams);
  if (k % 2 === 1) k -= 1; // make it even
  return k;
}


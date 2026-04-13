import type { Team } from "./types";

/**
 * Compute the team "on the clock" for a given overall pick in a
 * snake draft.
 *
 *   teams: sorted by draft_position ASC
 *   pickIndex: 0-based overall pick number
 */
export function teamOnTheClock(teams: Team[], pickIndex: number): Team {
  const n = teams.length;
  if (n === 0) throw new Error("No teams in league");

  const round = Math.floor(pickIndex / n);        // 0-based round
  const posInRound = pickIndex % n;               // 0-based slot in round
  const isReverseRound = round % 2 === 1;         // snake

  const slot = isReverseRound ? n - 1 - posInRound : posInRound;
  return teams[slot];
}

/**
 * Compute (round, pick_number) for a given overall pick index.
 * `round` is 1-based, `pick_number` is also 1-based overall.
 */
export function pickMeta(pickIndex: number, teamsCount: number) {
  return {
    round: Math.floor(pickIndex / teamsCount) + 1,
    pick_number: pickIndex + 1,
  };
}

/**
 * Randomize draft order (Fisher-Yates).
 */
export function randomizeDraftOrder<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

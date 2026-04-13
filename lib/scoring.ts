import type { RosterEntry } from "./types";

/**
 * Fantasy point value for a single player stat line.
 *   - 1 pt per goal
 *   - 1 pt per assist
 *   - +2 bonus (so 3 total) per OT goal, since the OT goal is ALSO counted
 *     in `goals`. We therefore add 2 * ot_goals on top.
 *
 * Stats coming from `player_stats` already have this applied via the
 * `fantasy_points` generated column, but this helper lets UI code compute
 * the same value from raw stats.
 */
export function pointsForPlayer(stats: {
  goals: number;
  assists: number;
  ot_goals: number;
}): number {
  return stats.goals + stats.assists + 2 * stats.ot_goals;
}

export interface ScoredTeam {
  scoring: RosterEntry[];
  bench: RosterEntry[];
  totalPoints: number;
}

/**
 * Compute a team's score according to the league rules:
 *   - The roster has `rosterSize` players (default 12).
 *   - Only the top `scoringRosterSize` (default 10) count toward the
 *     team score.
 *   - The top `scoringRosterSize` MUST include at least
 *     `requiredDefensemen` (default 2) defensemen, even if those D-men
 *     have fewer points than other available forwards.
 *
 * Selection algorithm:
 *   1. Sort the roster by fantasy points (desc), tiebreak by goals then
 *      games played.
 *   2. Walk the list greedily, picking the top scorers.
 *   3. If at the end we don't have enough D, swap the lowest-scoring
 *      non-D players in the scoring set for the highest-scoring D left
 *      on the bench until the D requirement is met.
 */
export function scoreTeam(
  roster: RosterEntry[],
  opts: {
    rosterSize?: number;
    scoringRosterSize?: number;
    requiredDefensemen?: number;
  } = {},
): ScoredTeam {
  const scoringRosterSize = opts.scoringRosterSize ?? 10;
  const requiredDefensemen = opts.requiredDefensemen ?? 2;

  const sorted = [...roster].sort((a, b) => {
    if (b.fantasy_points !== a.fantasy_points)
      return b.fantasy_points - a.fantasy_points;
    if (b.goals !== a.goals) return b.goals - a.goals;
    return b.games_played - a.games_played;
  });

  // First pass: greedy top-N.
  const scoring = sorted.slice(0, scoringRosterSize);
  const bench = sorted.slice(scoringRosterSize);

  // Ensure the D requirement.
  while (
    scoring.filter((p) => p.position === "D").length < requiredDefensemen
  ) {
    // Highest-scoring D still on the bench.
    const benchDIdx = bench.findIndex((p) => p.position === "D");
    if (benchDIdx === -1) break; // not enough D on the whole roster

    // Lowest-scoring non-D currently in the scoring set.
    let victimIdx = -1;
    for (let i = scoring.length - 1; i >= 0; i--) {
      if (scoring[i].position !== "D") {
        victimIdx = i;
        break;
      }
    }
    if (victimIdx === -1) break;

    const promoted = bench.splice(benchDIdx, 1)[0];
    const demoted = scoring.splice(victimIdx, 1)[0];
    scoring.push(promoted);
    bench.push(demoted);
  }

  // Re-sort the scoring set for display.
  scoring.sort((a, b) => b.fantasy_points - a.fantasy_points);
  bench.sort((a, b) => b.fantasy_points - a.fantasy_points);

  const totalPoints = scoring.reduce((sum, p) => sum + p.fantasy_points, 0);

  return { scoring, bench, totalPoints };
}

/**
 * Generate a human-friendly, unambiguous join code.
 * Avoids confusing characters (0/O, 1/I/L).
 */
export function generateJoinCode(length = 6): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

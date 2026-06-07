import type { MatchGoal, Player } from "./types";

export interface PlayerListRow {
  id: number;
  name: string;
  country_id: number | null;
  goals: number;
}

/** True if a goal counts toward a player's scoring tally (real goals only). */
export function isScoringGoal(g: { type: string; is_shootout: boolean }): boolean {
  return !g.is_shootout && g.type !== "own_goal";
}

/**
 * Count each player's goals from the match-goal rows (excluding own goals and
 * shootout PKs) and return every player, alphabetised. Players with no goals
 * still appear with 0 so the directory isn't empty pre-tournament.
 */
export function aggregatePlayerGoals(
  players: Player[],
  goals: Pick<MatchGoal, "scorer_player_id" | "type" | "is_shootout">[],
): PlayerListRow[] {
  const counts = new Map<number, number>();
  for (const g of goals) {
    if (g.scorer_player_id == null || !isScoringGoal(g)) continue;
    counts.set(g.scorer_player_id, (counts.get(g.scorer_player_id) ?? 0) + 1);
  }
  return players
    .map((p) => ({
      id: p.id,
      name: p.name,
      country_id: p.country_id,
      goals: counts.get(p.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

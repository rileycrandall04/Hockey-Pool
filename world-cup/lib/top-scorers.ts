import type { SupabaseClient } from "@supabase/supabase-js";

export interface TopScorer {
  player_id: number | null;
  player_name: string | null;
  country_id: number | null;
  goals: number;
}

/** Pull a player's name off a (possibly array-wrapped) Supabase join row. */
function joinName(players: unknown): string | null {
  if (Array.isArray(players)) return (players[0] as { name?: string } | undefined)?.name ?? null;
  return (players as { name?: string } | null)?.name ?? null;
}

/**
 * Compute the Golden Boot leaderboard straight from our ingested goals
 * (`match_goals`), rather than API-Football's lagging `/players/topscorers`
 * cache. Counts only countable goals — open play + run-of-play penalties —
 * excluding own goals and shootout penalties. This makes the race live (it
 * updates with every event sync) and consistent with the per-match scorer
 * lists shown elsewhere.
 *
 * Goals with no resolved scorer (player id null) can't be attributed to a
 * player, so they're omitted from the leaderboard. Sorted by goals desc,
 * ties broken deterministically by player id.
 */
export async function computeTopScorers(
  svc: SupabaseClient,
  limit = 25,
): Promise<TopScorer[]> {
  const { data } = await svc
    .from("match_goals")
    .select("scorer_player_id, country_id, type, is_shootout, players(name)")
    .eq("is_shootout", false)
    .neq("type", "own_goal");

  const tally = new Map<number, TopScorer>();
  for (const row of data ?? []) {
    const pid = row.scorer_player_id as number | null;
    if (pid == null) continue; // unknown scorer — can't credit a player
    const name = joinName(row.players);
    const existing = tally.get(pid);
    if (existing) {
      existing.goals += 1;
      if (!existing.player_name && name) existing.player_name = name;
    } else {
      tally.set(pid, {
        player_id: pid,
        player_name: name,
        country_id: (row.country_id as number) ?? null,
        goals: 1,
      });
    }
  }

  return [...tally.values()]
    .sort((a, b) => b.goals - a.goals || (a.player_id ?? 0) - (b.player_id ?? 0))
    .slice(0, limit);
}

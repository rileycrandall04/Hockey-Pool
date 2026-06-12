import type { SupabaseClient } from "@supabase/supabase-js";

export interface TopScorer {
  player_id: number | null;
  player_name: string | null;
  country_id: number | null;
  goals: number;
  /** Tiebreaker stats from the API cache (0 / null when unknown). */
  assists: number;
  minutes: number | null;
}

/** Pull a player's name off a (possibly array-wrapped) Supabase join row. */
function joinName(players: unknown): string | null {
  if (Array.isArray(players)) return (players[0] as { name?: string } | undefined)?.name ?? null;
  return (players as { name?: string } | null)?.name ?? null;
}

/**
 * Compute the Golden Boot leaderboard straight from our ingested goals
 * (`match_goals`) — open play + run-of-play penalties, excluding own goals and
 * shootout penalties — so the count is live and consistent with the per-match
 * scorer lists. Goals with no resolved scorer are omitted.
 *
 * Ordering follows the FIFA Golden Boot tiebreaker:
 *   1. most goals
 *   2. most assists
 *   3. fewest minutes played
 *   4. player id (stable, deterministic last resort)
 *
 * Assists and minutes aren't in our goal events, so they're read from the
 * API's `top_scorers` cache (joined by player id) purely as tiebreakers —
 * they only matter when goal counts are level.
 */
export async function computeTopScorers(
  svc: SupabaseClient,
  limit = 25,
): Promise<TopScorer[]> {
  const [{ data: goalRows }, { data: statRows }] = await Promise.all([
    svc
      .from("match_goals")
      .select("scorer_player_id, country_id, type, is_shootout, players(name)")
      .eq("is_shootout", false)
      .neq("type", "own_goal"),
    svc.from("top_scorers").select("player_id, assists, minutes"),
  ]);

  // Tiebreaker stats keyed by our player id.
  const stat = new Map<number, { assists: number; minutes: number | null }>();
  for (const r of statRows ?? []) {
    if (r.player_id != null) {
      stat.set(r.player_id as number, {
        assists: (r.assists as number) ?? 0,
        minutes: (r.minutes as number) ?? null,
      });
    }
  }

  const tally = new Map<number, TopScorer>();
  for (const row of goalRows ?? []) {
    const pid = row.scorer_player_id as number | null;
    if (pid == null) continue; // unknown scorer — can't credit a player
    const name = joinName(row.players);
    const existing = tally.get(pid);
    if (existing) {
      existing.goals += 1;
      if (!existing.player_name && name) existing.player_name = name;
    } else {
      const s = stat.get(pid);
      tally.set(pid, {
        player_id: pid,
        player_name: name,
        country_id: (row.country_id as number) ?? null,
        goals: 1,
        assists: s?.assists ?? 0,
        minutes: s?.minutes ?? null,
      });
    }
  }

  // Fewest minutes ranks higher; unknown minutes sort last among a tie.
  const mins = (m: number | null) => (m == null ? Number.POSITIVE_INFINITY : m);

  return [...tally.values()]
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        b.assists - a.assists ||
        mins(a.minutes) - mins(b.minutes) ||
        (a.player_id ?? 0) - (b.player_id ?? 0),
    )
    .slice(0, limit);
}

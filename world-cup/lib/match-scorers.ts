import type { SupabaseClient } from "@supabase/supabase-js";

export interface ScorerLine {
  match_id: string;
  country_id: number | null;
  player_id: number | null;
  player_name: string | null;
  minute: number | null;
  type: string;
  is_shootout: boolean;
}

/**
 * Load goal scorers for a set of matches, grouped by match id. Each line
 * carries the scoring country, the player (id + name for linking), the
 * minute, and the goal type (regular/penalty/own_goal).
 */
export async function loadScorersByMatch(
  svc: SupabaseClient,
  matchIds: string[],
): Promise<Map<string, ScorerLine[]>> {
  const out = new Map<string, ScorerLine[]>();
  if (matchIds.length === 0) return out;

  const { data } = await svc
    .from("match_goals")
    .select("match_id, country_id, scorer_player_id, minute, type, is_shootout, players(name)")
    .in("match_id", matchIds)
    .order("minute", { ascending: true, nullsFirst: true });

  for (const row of data ?? []) {
    const player = row.players as { name: string } | { name: string }[] | null;
    const name = Array.isArray(player) ? player[0]?.name ?? null : player?.name ?? null;
    const line: ScorerLine = {
      match_id: row.match_id as string,
      country_id: (row.country_id as number) ?? null,
      player_id: (row.scorer_player_id as number) ?? null,
      player_name: name,
      minute: (row.minute as number) ?? null,
      type: row.type as string,
      is_shootout: Boolean(row.is_shootout),
    };
    const arr = out.get(line.match_id) ?? [];
    arr.push(line);
    out.set(line.match_id, arr);
  }
  return out;
}

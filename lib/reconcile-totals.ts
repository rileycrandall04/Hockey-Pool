import type { createServiceClient } from "@/lib/supabase/server";

export interface ReconcileTotalsResult {
  players_checked: number;
  players_updated: number;
  errors: string[];
}

/**
 * Rebuild `player_stats` for the given player ids (or every player
 * that has any per-game data, when ids is omitted) from the sum of
 * their `manual_game_stats` rows.
 *
 * Used by:
 *   - the nightly cron, as a self-heal in case a dual-write
 *     anywhere drifted player_stats out of sync;
 *   - the /admin/reconcile-totals admin page, for ad-hoc fixes.
 *
 * Only writes rows where the recomputed totals differ from the
 * existing player_stats values — so it's safe to call defensively
 * and won't churn `updated_at` for players whose data already
 * matches.
 */
export async function reconcilePlayerTotals(
  svc: ReturnType<typeof createServiceClient>,
  options: { playerIds?: number[] } = {},
): Promise<ReconcileTotalsResult> {
  const { playerIds } = options;

  // 1. Pull every relevant manual_game_stats row and aggregate.
  let manualQuery = svc
    .from("manual_game_stats")
    .select("player_id, game_id, goals, assists, ot_goals");
  if (playerIds && playerIds.length > 0) {
    manualQuery = manualQuery.in("player_id", playerIds);
  }
  const { data: manualRows, error: manualError } = await manualQuery;
  if (manualError) {
    return {
      players_checked: 0,
      players_updated: 0,
      errors: [`manual_game_stats query: ${manualError.message}`],
    };
  }

  interface Agg {
    goals: number;
    assists: number;
    ot_goals: number;
    games: Set<number>;
  }
  const expected = new Map<number, Agg>();
  for (const r of manualRows ?? []) {
    let a = expected.get(r.player_id);
    if (!a) {
      a = { goals: 0, assists: 0, ot_goals: 0, games: new Set() };
      expected.set(r.player_id, a);
    }
    a.goals += r.goals;
    a.assists += r.assists;
    a.ot_goals += r.ot_goals;
    if (r.goals > 0 || r.assists > 0 || r.ot_goals > 0) {
      a.games.add(r.game_id);
    }
  }

  // 2. Pull current player_stats rows so we only write when something
  //    actually changed.
  let statsQuery = svc
    .from("player_stats")
    .select("player_id, goals, assists, ot_goals, games_played");
  if (playerIds && playerIds.length > 0) {
    statsQuery = statsQuery.in("player_id", playerIds);
  }
  const { data: statsRows } = await statsQuery;
  const actual = new Map<
    number,
    {
      goals: number;
      assists: number;
      ot_goals: number;
      games_played: number;
    }
  >();
  for (const r of statsRows ?? []) actual.set(r.player_id, r);

  // 3. Build the upsert payload — only players whose row drifted.
  const allPlayerIds = new Set<number>([
    ...expected.keys(),
    ...actual.keys(),
  ]);
  const updates: {
    player_id: number;
    goals: number;
    assists: number;
    ot_goals: number;
    games_played: number;
    updated_at: string;
  }[] = [];
  for (const pid of allPlayerIds) {
    const a = expected.get(pid) ?? {
      goals: 0,
      assists: 0,
      ot_goals: 0,
      games: new Set<number>(),
    };
    const next = {
      goals: a.goals,
      assists: a.assists,
      ot_goals: Math.min(a.ot_goals, a.goals),
      games_played: a.games.size,
    };
    const cur = actual.get(pid);
    const drifted =
      !cur ||
      cur.goals !== next.goals ||
      cur.assists !== next.assists ||
      cur.ot_goals !== next.ot_goals ||
      cur.games_played !== next.games_played;
    if (!drifted) continue;
    updates.push({
      player_id: pid,
      ...next,
      updated_at: new Date().toISOString(),
    });
  }

  // 4. Upsert in chunks to stay under Supabase REST limits.
  const errors: string[] = [];
  let appliedRows = 0;
  const chunkSize = 500;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const { error } = await svc
      .from("player_stats")
      .upsert(chunk, { onConflict: "player_id" });
    if (error) {
      errors.push(error.message);
    } else {
      appliedRows += chunk.length;
    }
  }

  return {
    players_checked: allPlayerIds.size,
    players_updated: appliedRows,
    errors,
  };
}

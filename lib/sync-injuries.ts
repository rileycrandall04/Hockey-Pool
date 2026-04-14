import { createServiceClient } from "./supabase/server";
import { fetchPlayerInjury } from "./nhl-api";

export interface SyncInjuriesResult {
  checked: number;
  flagged: number;
  cleared: number;
  unchanged: number;
  errors: number;
  duration_ms: number;
}

/**
 * Best-effort batch refresh of the GLOBAL injury_status column for
 * every active player. This is the NHL-feed source of truth — per-
 * league commissioner overrides live in league_player_injuries and
 * are not touched by this function.
 *
 * Capped at `limit` players per call to fit comfortably under the
 * Vercel serverless function timeout. The default 200 takes about
 * 30-45 seconds for a fully populated pool.
 *
 * Used by:
 *   - /api/cron/update-stats           (nightly, 6am ET)
 *   - /api/admin/sync-injuries         (manual, app owner only)
 */
export async function syncInjuries(limit = 200): Promise<SyncInjuriesResult> {
  const start = Date.now();
  const svc = createServiceClient();

  const { data: activePlayers } = await svc
    .from("players")
    .select("id, injury_status")
    .eq("active", true)
    .limit(limit);

  const result: SyncInjuriesResult = {
    checked: 0,
    flagged: 0,
    cleared: 0,
    unchanged: 0,
    errors: 0,
    duration_ms: 0,
  };

  if (!activePlayers || activePlayers.length === 0) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Fan out 10 fetches at a time. The NHL public API tolerates this
  // comfortably; higher concurrency starts hitting tail latency.
  const concurrency = 10;
  for (let i = 0; i < activePlayers.length; i += concurrency) {
    const batch = activePlayers.slice(i, i + concurrency);
    const responses = await Promise.all(
      batch.map(async (p) => ({
        id: p.id as number,
        was: (p.injury_status as string | null) ?? null,
        info: await fetchPlayerInjury(p.id as number),
      })),
    );

    for (const r of responses) {
      result.checked += 1;
      if (r.info.source === "error") {
        result.errors += 1;
        continue;
      }
      const newStatus = r.info.status;
      const newDescription = r.info.description;

      if (newStatus === r.was) {
        result.unchanged += 1;
        continue;
      }

      const { error } = await svc
        .from("players")
        .update({
          injury_status: newStatus,
          injury_description: newDescription,
          injury_updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      if (error) {
        result.errors += 1;
      } else if (newStatus) {
        result.flagged += 1;
      } else {
        result.cleared += 1;
      }
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
}

import { createServiceClient } from "./supabase/server";
import { fetchPlayerInjury } from "./nhl-api";

export interface SyncInjuriesResult {
  checked: number;
  flagged: number;
  cleared: number;
  unchanged: number;
  errors: number;
  /**
   * Up to 5 unique error messages from the failed fetches. Useful
   * when a large fraction of the batch errors out and we want to
   * see what the NHL API is actually telling us without trawling
   * Vercel logs from a phone.
   */
  sample_errors: string[];
  duration_ms: number;
}

/**
 * Best-effort batch refresh of the GLOBAL injury_status column for
 * active players. This is the NHL-feed source of truth — per-league
 * commissioner overrides live in league_player_injuries and are not
 * touched by this function.
 *
 * Pacing: the NHL public API rate-limits aggressively (429 Too Many
 * Requests after ~60 concurrent hits). We avoid that by running 2
 * concurrent requests at a time with a 200ms pause between batches,
 * which gives us ~10 requests/sec steady state. A 429 is retried once
 * after 2s; if it still fails, we skip that player and the next cron
 * run will pick them up.
 *
 * Rotation: each run checks the `limit` players with the oldest (or
 * null) injury_updated_at first, then stamps their injury_updated_at
 * to now() so subsequent runs rotate through the rest of the pool.
 * Over a few daily cron runs every active player eventually gets
 * refreshed.
 *
 * 404 handling: `/player/{id}/landing` returns 404 for prospect/AHL
 * players who appear on roster endpoints but don't have a full NHL
 * profile. We treat these as "healthy / no injury data" rather than
 * errors, so the error counter reflects real problems only.
 *
 * Used by:
 *   - /api/cron/update-stats           (nightly, 6am ET)
 *   - /api/admin/sync-injuries         (manual, app owner only)
 */
export async function syncInjuries(limit = 150): Promise<SyncInjuriesResult> {
  const start = Date.now();
  const svc = createServiceClient();

  const { data: activePlayers } = await svc
    .from("players")
    .select("id, injury_status")
    .eq("active", true)
    // Stalest first (nulls = never checked) so each run rotates
    // through a different slice of the pool.
    .order("injury_updated_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const result: SyncInjuriesResult = {
    checked: 0,
    flagged: 0,
    cleared: 0,
    unchanged: 0,
    errors: 0,
    sample_errors: [],
    duration_ms: 0,
  };
  const sampleErrorSet = new Set<string>();

  if (!activePlayers || activePlayers.length === 0) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Low-concurrency pacing. With 150 players this schedule takes
  // ~30s under normal conditions.
  const concurrency = 2;
  const pauseBetweenBatchesMs = 200;
  const retryDelayMs = 2000;

  const fetchWithRetry = async (playerId: number) => {
    let info = await fetchPlayerInjury(playerId);
    if (info.source === "error" && info.error?.includes("429")) {
      // One retry after a generous backoff. If the API is hammered
      // we're better off moving on than piling up more retries.
      await sleep(retryDelayMs);
      info = await fetchPlayerInjury(playerId);
    }
    return info;
  };

  for (let i = 0; i < activePlayers.length; i += concurrency) {
    const batch = activePlayers.slice(i, i + concurrency);
    const responses = await Promise.all(
      batch.map(async (p) => ({
        id: p.id as number,
        was: (p.injury_status as string | null) ?? null,
        info: await fetchWithRetry(p.id as number),
      })),
    );

    for (const r of responses) {
      result.checked += 1;

      // 404 = player has no landing record (prospect / AHL / inactive).
      // Treat as "healthy"; clear any stale flag and update the
      // timestamp so they rotate out of the next run's top slice.
      if (
        r.info.source === "error" &&
        (r.info.error?.includes("404") ?? false)
      ) {
        await svc
          .from("players")
          .update({
            injury_status: null,
            injury_description: null,
            injury_updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        if (r.was !== null) result.cleared += 1;
        else result.unchanged += 1;
        continue;
      }

      if (r.info.source === "error") {
        result.errors += 1;
        if (sampleErrorSet.size < 5) {
          const generic = (r.info.error ?? "unknown error").replace(
            /\/player\/\d+\/landing/,
            "/player/{id}/landing",
          );
          sampleErrorSet.add(generic);
        }
        continue;
      }

      const newStatus = r.info.status;
      const newDescription = r.info.description;

      // Always bump injury_updated_at on a successful check so
      // rotation keeps moving even when the status didn't change.
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
      } else if (newStatus === r.was) {
        result.unchanged += 1;
      } else if (newStatus) {
        result.flagged += 1;
      } else {
        result.cleared += 1;
      }
    }

    // Pause between batches — don't sleep after the last one.
    if (i + concurrency < activePlayers.length) {
      await sleep(pauseBetweenBatchesMs);
    }
  }

  result.sample_errors = [...sampleErrorSet];
  result.duration_ms = Date.now() - start;
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

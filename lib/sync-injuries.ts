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
  /**
   * True if we hit the time budget and stopped fetching early. The
   * remaining players will be picked up by the next run thanks to
   * the injury_updated_at rotation.
   */
  truncated: boolean;
  duration_ms: number;
}

/**
 * Best-effort batch refresh of the GLOBAL injury_status column for
 * active players. This is the NHL-feed source of truth — per-league
 * commissioner overrides live in league_player_injuries and are not
 * touched by this function.
 *
 * Architecture
 * ------------
 *
 *   Phase 1: fetch from NHL API (rate-limited)
 *     - Concurrency 2 with a 150ms pause between batches
 *     - One retry on 429 with a 1.5s backoff
 *     - 404 -> "no injury data" (prospects / AHL / inactive)
 *     - All results collected into an in-memory `pendingUpdates` array
 *     - Hard time budget: stop fetching at 45s elapsed
 *
 *   Phase 2: write back to Supabase (parallel)
 *     - All accumulated updates fired in parallel chunks of 10
 *     - This is the critical optimization vs the previous version,
 *       which was running 150 sequential UPDATEs serialized inside
 *       the fetch loop and stacking ~20s of DB latency on top of
 *       the ~30s of NHL API time, causing 504 timeouts at 60s.
 *
 * Rotation
 * --------
 *
 * The SELECT orders by injury_updated_at ASC NULLS FIRST so each
 * run picks the staleest players first. EVERY successful check
 * stamps injury_updated_at = now() so subsequent runs rotate
 * through different slices of the pool. Over 5-6 daily cron runs
 * we cycle through every active player.
 */
export async function syncInjuries(limit = 150): Promise<SyncInjuriesResult> {
  const start = Date.now();
  const svc = createServiceClient();

  const { data: activePlayers } = await svc
    .from("players")
    .select("id, injury_status")
    .eq("active", true)
    .order("injury_updated_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const result: SyncInjuriesResult = {
    checked: 0,
    flagged: 0,
    cleared: 0,
    unchanged: 0,
    errors: 0,
    sample_errors: [],
    truncated: false,
    duration_ms: 0,
  };
  const sampleErrorSet = new Set<string>();

  if (!activePlayers || activePlayers.length === 0) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Conservative pacing for the NHL public API.
  const concurrency = 2;
  const pauseBetweenBatchesMs = 150;
  const retryDelayMs = 1500;
  // Stop fetching at this elapsed time so the write phase can still
  // finish inside the 60s serverless function timeout.
  const fetchBudgetMs = 45_000;

  type PendingUpdate = {
    id: number;
    injury_status: string | null;
    injury_description: string | null;
    classification: "flagged" | "cleared" | "unchanged";
  };
  const pendingUpdates: PendingUpdate[] = [];

  const fetchWithRetry = async (playerId: number) => {
    let info = await fetchPlayerInjury(playerId);
    if (info.source === "error" && info.error?.includes("429")) {
      await sleep(retryDelayMs);
      info = await fetchPlayerInjury(playerId);
    }
    return info;
  };

  // -------------------------------------------------------------------
  // Phase 1: fetch
  // -------------------------------------------------------------------
  for (let i = 0; i < activePlayers.length; i += concurrency) {
    if (Date.now() - start > fetchBudgetMs) {
      result.truncated = true;
      break;
    }

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

      // 404 = no landing record; treat as "healthy".
      if (
        r.info.source === "error" &&
        (r.info.error?.includes("404") ?? false)
      ) {
        pendingUpdates.push({
          id: r.id,
          injury_status: null,
          injury_description: null,
          classification: r.was !== null ? "cleared" : "unchanged",
        });
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
      let classification: PendingUpdate["classification"];
      if (newStatus === r.was) classification = "unchanged";
      else if (newStatus) classification = "flagged";
      else classification = "cleared";

      pendingUpdates.push({
        id: r.id,
        injury_status: newStatus,
        injury_description: newDescription,
        classification,
      });
    }

    // Pause between batches — but skip the pause on the last iteration.
    if (i + concurrency < activePlayers.length) {
      await sleep(pauseBetweenBatchesMs);
    }
  }

  // -------------------------------------------------------------------
  // Phase 2: write (parallel chunks)
  // -------------------------------------------------------------------
  const writeChunkSize = 10;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < pendingUpdates.length; i += writeChunkSize) {
    const chunk = pendingUpdates.slice(i, i + writeChunkSize);
    const writes = await Promise.all(
      chunk.map(async (u) => {
        const { error } = await svc
          .from("players")
          .update({
            injury_status: u.injury_status,
            injury_description: u.injury_description,
            injury_updated_at: nowIso,
          })
          .eq("id", u.id);
        return { u, ok: !error };
      }),
    );

    for (const { u, ok } of writes) {
      if (!ok) {
        result.errors += 1;
        continue;
      }
      if (u.classification === "flagged") result.flagged += 1;
      else if (u.classification === "cleared") result.cleared += 1;
      else result.unchanged += 1;
    }
  }

  result.sample_errors = [...sampleErrorSet];
  result.duration_ms = Date.now() - start;
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

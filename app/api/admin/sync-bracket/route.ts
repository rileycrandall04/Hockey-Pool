import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { syncPlayoffBracket } from "@/lib/sync-bracket";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manually trigger a playoff bracket refresh.
 *
 * Same code path as the nightly cron's bracket step. Pulls the
 * current bracket + per-series schedules from the NHL public API
 * and upserts into `playoff_series` + `playoff_games`.
 *
 * Safe to run on-demand — the sync is idempotent: every upsert is
 * keyed by series_letter / game_id, and stale series from a prior
 * playoff year are purged by letter. Unlike the stats cron, it does
 * NOT mutate cumulative counters, so running it twice in a row is
 * a no-op.
 *
 * Auth: signed-in user whose email matches APP_OWNER_EMAIL. Returns
 * JSON with the sync summary (series/games upserted, any errors).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (!isAppOwner(user.email)) {
    return NextResponse.json(
      { ok: false, error: "Only the app owner can sync the bracket." },
      { status: 403 },
    );
  }

  try {
    const result = await syncPlayoffBracket();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

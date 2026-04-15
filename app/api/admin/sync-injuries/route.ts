import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncInjuries } from "@/lib/sync-injuries";
import { isAppOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manually trigger a global injury sync from the NHL public API.
 *
 * Same code path as the nightly cron's injury step. Refreshes the
 * GLOBAL players.injury_status column for ~40 active players per
 * call. Per-league commissioner overrides in league_player_injuries
 * are NOT touched.
 *
 * Auth: signed-in user whose email matches APP_OWNER_EMAIL. If
 * APP_OWNER_EMAIL is unset (open-mode), any signed-in user can run
 * it — same backwards-compat fallback as /api/admin/reseed.
 *
 * Two response modes:
 *   1. Default — redirect to /dashboard with a success/error flash
 *      so a plain HTML form POST works on mobile with no JS.
 *   2. ?format=json — return JSON. Used by the InjurySweepRunner
 *      client component to drive the multi-iteration full sweep.
 *
 * Optional query param:
 *   ?since=<iso>  — only consider players whose injury_updated_at is
 *                    NULL or older than the given ISO timestamp.
 *                    Used by the sweep so consecutive iterations
 *                    don't re-cover players that were just refreshed.
 *                    The route returns `remaining` in JSON mode so
 *                    the sweep knows when to stop.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get("format") === "json";
  const since = url.searchParams.get("since") ?? undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    return NextResponse.redirect(new URL("/login", request.url), {
      status: 303,
    });
  }

  if (!isAppOwner(user.email)) {
    if (wantsJson) {
      return NextResponse.json(
        { ok: false, error: "Only the app owner can sync injuries." },
        { status: 403 },
      );
    }
    const redirectUrl = new URL("/dashboard", request.url);
    redirectUrl.searchParams.set(
      "seed_error",
      "Only the app owner can sync injuries.",
    );
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  try {
    const result = await syncInjuries(40, since);

    if (wantsJson) {
      return NextResponse.json({ ok: true, ...result });
    }

    const redirectUrl = new URL("/dashboard", request.url);
    const parts = [
      `${result.checked} checked`,
      `${result.flagged} newly flagged`,
      `${result.cleared} cleared`,
      `${result.unchanged} unchanged`,
    ];
    if (result.errors > 0) parts.push(`${result.errors} errors`);
    if (result.truncated) parts.push("truncated (time budget)");
    redirectUrl.searchParams.set(
      "seeded",
      `Injury sync · ${parts.join(" · ")} (${(result.duration_ms / 1000).toFixed(1)}s)`,
    );
    if (result.sample_errors.length > 0) {
      redirectUrl.searchParams.set(
        "sync_errors",
        result.sample_errors.join(" || "),
      );
    }
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";

    if (wantsJson) {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 500 },
      );
    }
    const redirectUrl = new URL("/dashboard", request.url);
    redirectUrl.searchParams.set(
      "seed_error",
      `Injury sync failed: ${message}`,
    );
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}

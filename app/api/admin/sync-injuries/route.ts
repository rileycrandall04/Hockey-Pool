import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncInjuries } from "@/lib/sync-injuries";
import { isAppOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manually trigger a global injury sync from the NHL public API.
 *
 * Same code path as the nightly cron's injury step — refreshes the
 * GLOBAL players.injury_status column for up to 200 active players.
 * Per-league commissioner overrides in league_player_injuries are
 * NOT touched.
 *
 * Auth: signed-in user whose email matches APP_OWNER_EMAIL. If
 * APP_OWNER_EMAIL is unset (open-mode), any signed-in user can run
 * it — same backwards-compat fallback as /api/admin/reseed.
 *
 * Plain HTML form POST → redirect with success/error flash so it
 * works from a phone with no JS.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), {
      status: 303,
    });
  }

  if (!isAppOwner(user.email)) {
    const url = new URL("/dashboard", request.url);
    url.searchParams.set(
      "seed_error",
      "Only the app owner can sync injuries.",
    );
    return NextResponse.redirect(url, { status: 303 });
  }

  try {
    const result = await syncInjuries();
    const url = new URL("/dashboard", request.url);
    const parts = [
      `${result.checked} checked`,
      `${result.flagged} newly flagged`,
      `${result.cleared} cleared`,
      `${result.unchanged} unchanged`,
    ];
    if (result.errors > 0) parts.push(`${result.errors} errors`);
    url.searchParams.set(
      "seeded",
      `Injury sync · ${parts.join(" · ")} (${(result.duration_ms / 1000).toFixed(1)}s)`,
    );
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    const url = new URL("/dashboard", request.url);
    url.searchParams.set(
      "seed_error",
      `Injury sync failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return NextResponse.redirect(url, { status: 303 });
  }
}

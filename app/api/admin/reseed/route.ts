import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { seedPlayers } from "@/lib/seed-players";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Re-run the player pool seed unconditionally.
 *
 * Unlike /api/admin/seed (which is gated to first-run when the pool is
 * empty), this route lets any signed-in user refresh roster data + this
 * season's regular-season points whenever they want — useful after we
 * add new columns to `players` (e.g., season_points) and need to
 * backfill them without waiting for the nightly cron.
 *
 * Redirects to /dashboard with a success or error flash so the form
 * works from a plain HTML POST with no client JS.
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

  try {
    const result = await seedPlayers();
    const url = new URL("/dashboard", request.url);
    url.searchParams.set(
      "seeded",
      `${result.teams} teams · ${result.players} players · ${result.players_with_season_stats} with ${result.season_used} stats`,
    );
    if (result.teams_without_stats.length > 0) {
      url.searchParams.set(
        "seed_warning",
        `Season stats unavailable for: ${result.teams_without_stats.join(", ")}`,
      );
    }
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    const url = new URL("/dashboard", request.url);
    url.searchParams.set(
      "seed_error",
      err instanceof Error ? err.message : "Unknown error",
    );
    return NextResponse.redirect(url, { status: 303 });
  }
}

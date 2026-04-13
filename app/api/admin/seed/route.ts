import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { seedPlayers } from "@/lib/seed-players";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-click "seed the player pool" endpoint for first-time setup.
 *
 * Guards:
 *   - Caller must be a signed-in user.
 *   - The players table must currently be empty (first-run).
 *
 * After the first successful seed, this endpoint refuses further calls.
 * To re-seed later (e.g., to switch from "all teams" to the 16 playoff
 * teams), use /api/cron/sync-players with the CRON_SECRET, or truncate
 * the players table in Supabase first.
 *
 * This is the same POST handler wired to a regular HTML form on the
 * dashboard, so it redirects on success/failure to keep things snappy
 * from a mobile browser with no JS.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }

  const svc = createServiceClient();
  const { count, error: countError } = await svc
    .from("players")
    .select("id", { count: "exact", head: true });
  if (countError) {
    return redirectWithError(request, countError.message);
  }
  if ((count ?? 0) > 0) {
    return redirectWithError(
      request,
      "Player pool already seeded. Use the cron endpoint to refresh.",
    );
  }

  try {
    const result = await seedPlayers();
    const url = new URL("/dashboard", request.url);
    url.searchParams.set(
      "seeded",
      `${result.teams} teams, ${result.players} players`,
    );
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return redirectWithError(request, message);
  }
}

function redirectWithError(request: Request, message: string) {
  const url = new URL("/dashboard", request.url);
  url.searchParams.set("seed_error", message);
  return NextResponse.redirect(url, { status: 303 });
}

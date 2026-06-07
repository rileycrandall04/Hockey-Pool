import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { autoDraftEntire } from "@/lib/draft-server";

/**
 * Commissioner-only: auto-run the ENTIRE draft — randomize the order, then
 * snake-pick best-available (by FIFA rank) for every team until rosters are
 * full. Use once all owners have joined.
 */
export async function POST(request: Request) {
  const { leagueId } = await request.json().catch(() => ({}) as { leagueId?: string });
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("commissioner_id")
    .eq("id", leagueId)
    .single();
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.commissioner_id !== user.id) {
    return NextResponse.json({ error: "Commissioner only" }, { status: 403 });
  }

  const result = await autoDraftEntire(svc, leagueId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, picks: result.picks });
}

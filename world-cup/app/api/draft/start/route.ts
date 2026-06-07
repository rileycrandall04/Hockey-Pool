import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { randomizeDraftOrder, teamOnTheClock, evenRosterSize } from "@/lib/draft";
import type { Team } from "@/lib/types";

/**
 * Commissioner-only: start the draft. Assigns a random order if one
 * hasn't been set yet, then flips the league to in_progress and puts the
 * first team on the clock.
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
    .select("*")
    .eq("id", leagueId)
    .single();
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.commissioner_id !== user.id) {
    return NextResponse.json({ error: "Commissioner only" }, { status: 403 });
  }
  if (league.draft_status !== "pending") {
    return NextResponse.json({ error: "Draft already started" }, { status: 409 });
  }

  // Make sure there are countries to draft.
  const { count: countryCount } = await svc
    .from("countries")
    .select("id", { count: "exact", head: true });
  if ((countryCount ?? 0) === 0) {
    return NextResponse.json(
      { error: "No countries seeded yet — run migration 0002 to load the field." },
      { status: 409 },
    );
  }

  let { data: teams } = await svc.from("teams").select("*").eq("league_id", leagueId);
  let teamList = (teams ?? []) as Team[];
  if (teamList.length === 0) {
    return NextResponse.json({ error: "No teams in league" }, { status: 409 });
  }

  // Even, equal teams-per-owner for this many owners; the leftover lowest-
  // ranked teams go undrafted.
  const rosterSize = evenRosterSize(teamList.length);
  if (rosterSize < 2) {
    return NextResponse.json({ error: "This draft supports up to 24 owners \u2014 the 48-team field can't be split evenly among more" }, { status: 409 });
  }
  if ((countryCount ?? 0) < teamList.length * rosterSize) {
    return NextResponse.json({ error: "Not enough countries seeded for this many owners" }, { status: 409 });
  }

  // Assign a random order if positions aren't set.
  const needsOrder = teamList.some((t) => t.draft_position == null);
  if (needsOrder) {
    const shuffled = randomizeDraftOrder(teamList);
    for (let i = 0; i < shuffled.length; i++) {
      await svc.from("teams").update({ draft_position: i + 1 }).eq("id", shuffled[i].id);
    }
    teamList = shuffled.map((t, i) => ({ ...t, draft_position: i + 1 }));
  }

  teamList.sort((a, b) => (a.draft_position ?? 0) - (b.draft_position ?? 0));
  const first = teamOnTheClock(teamList, 0);

  await svc
    .from("leagues")
    .update({
      draft_status: "in_progress",
      draft_round: 1,
      draft_current_team: first.id,
      draft_started_at: new Date().toISOString(),
      roster_size: rosterSize,
    })
    .eq("id", leagueId);

  return NextResponse.json({ ok: true, onClock: first.name });
}

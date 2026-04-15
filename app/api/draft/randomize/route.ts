import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { randomizeDraftOrder } from "@/lib/draft";
import type { Team } from "@/lib/types";

/**
 * Commissioner-only endpoint to randomize (or re-randomize) the
 * draft order BEFORE the draft starts.
 *
 * Writes `draft_position` 1..N on the teams in a random permutation
 * and returns the ordered list so the draft room can show the
 * result immediately without a Realtime round-trip.
 *
 * Safe to call repeatedly — each call overwrites the previous
 * randomization. Refuses to run once the draft is in_progress or
 * complete so an accidental tap mid-draft can't scramble the board.
 */
export async function POST(request: Request) {
  const { league_id } = (await request.json()) as { league_id?: string };
  if (!league_id) {
    return NextResponse.json({ error: "league_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data: league, error: leagueError } = await svc
    .from("leagues")
    .select("commissioner_id, draft_status")
    .eq("id", league_id)
    .single();
  if (leagueError || !league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }
  if (league.commissioner_id !== user.id) {
    return NextResponse.json(
      { error: "Only the commissioner can randomize draft order" },
      { status: 403 },
    );
  }
  if (league.draft_status !== "pending") {
    return NextResponse.json(
      { error: "Draft order is locked once the draft starts" },
      { status: 400 },
    );
  }

  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", league_id);
  if (!teams || teams.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 teams to randomize" },
      { status: 400 },
    );
  }

  const order = randomizeDraftOrder(teams as Team[]);
  for (let i = 0; i < order.length; i++) {
    const { error: updateError } = await svc
      .from("teams")
      .update({ draft_position: i + 1 })
      .eq("id", order[i].id);
    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }
  }

  // Re-read sorted so the client can render in the new order without
  // recomputing anything.
  const { data: orderedTeams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", league_id)
    .order("draft_position", { ascending: true, nullsFirst: false });

  return NextResponse.json({ ok: true, teams: orderedTeams ?? order });
}

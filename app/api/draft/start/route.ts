import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { randomizeDraftOrder } from "@/lib/draft";

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
    .select("*")
    .eq("id", league_id)
    .single();
  if (leagueError || !league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }
  if (league.commissioner_id !== user.id) {
    return NextResponse.json(
      { error: "Only the commissioner can start the draft" },
      { status: 403 },
    );
  }
  if (league.draft_status !== "pending") {
    return NextResponse.json(
      { error: "Draft already started or complete" },
      { status: 400 },
    );
  }

  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", league_id);

  if (!teams || teams.length < 2) {
    return NextResponse.json(
      { error: "Need at least 2 teams to draft" },
      { status: 400 },
    );
  }

  const order = randomizeDraftOrder(teams);
  for (let i = 0; i < order.length; i++) {
    await svc
      .from("teams")
      .update({ draft_position: i + 1 })
      .eq("id", order[i].id);
  }

  const { data: updatedLeague, error: updateError } = await svc
    .from("leagues")
    .update({
      draft_status: "in_progress",
      draft_started_at: new Date().toISOString(),
      draft_current_team: order[0].id,
      draft_round: 1,
    })
    .eq("id", league_id)
    .select("*")
    .single();
  if (updateError || !updatedLeague) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to start draft" },
      { status: 500 },
    );
  }

  // Re-read the teams with the freshly assigned draft_position so the
  // client can update its local state immediately, without waiting for
  // a Realtime UPDATE event to round-trip from Postgres.
  const { data: orderedTeams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", league_id)
    .order("draft_position", { ascending: true, nullsFirst: false });

  return NextResponse.json({
    ok: true,
    league: updatedLeague,
    teams: orderedTeams ?? order,
  });
}

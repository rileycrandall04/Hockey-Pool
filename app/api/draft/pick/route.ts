import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { teamOnTheClock, pickMeta } from "@/lib/draft";
import { sendPushToUser } from "@/lib/push";
import type { Team } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    league_id?: string;
    team_id?: string;
    player_id?: number;
  };
  const { league_id, team_id, player_id } = body;
  if (!league_id || !team_id || !player_id) {
    return NextResponse.json(
      { error: "league_id, team_id and player_id required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  const { data: league } = await svc
    .from("leagues")
    .select("*")
    .eq("id", league_id)
    .single();
  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }
  if (league.draft_status !== "in_progress") {
    return NextResponse.json(
      { error: "Draft is not in progress" },
      { status: 400 },
    );
  }

  const { data: team } = await svc
    .from("teams")
    .select("*")
    .eq("id", team_id)
    .single();
  if (!team || team.league_id !== league_id) {
    return NextResponse.json({ error: "Team not in league" }, { status: 400 });
  }

  // A user can only pick on their own team, unless they're the commissioner.
  const isCommissioner = league.commissioner_id === user.id;
  if (!isCommissioner && team.owner_id !== user.id) {
    return NextResponse.json(
      { error: "Not your team" },
      { status: 403 },
    );
  }

  // Enforce snake order.
  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", league_id)
    .order("draft_position", { ascending: true, nullsFirst: false });
  const { data: existingPicks } = await svc
    .from("draft_picks")
    .select("id")
    .eq("league_id", league_id);

  const pickIndex = existingPicks?.length ?? 0;
  const totalPicks = (teams?.length ?? 0) * league.roster_size;
  if (pickIndex >= totalPicks) {
    // Mark draft complete.
    await svc
      .from("leagues")
      .update({ draft_status: "complete", draft_current_team: null })
      .eq("id", league_id);
    return NextResponse.json({ error: "Draft already complete" }, { status: 400 });
  }

  const onClock = teamOnTheClock((teams ?? []) as Team[], pickIndex);
  if (onClock.id !== team_id) {
    return NextResponse.json(
      { error: `It's ${onClock.name}'s pick` },
      { status: 400 },
    );
  }

  // Verify the player is valid and unpicked.
  const { data: player } = await svc
    .from("players")
    .select("id, active")
    .eq("id", player_id)
    .single();
  if (!player || !player.active) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }
  const { data: existingPick } = await svc
    .from("draft_picks")
    .select("id")
    .eq("league_id", league_id)
    .eq("player_id", player_id)
    .maybeSingle();
  if (existingPick) {
    return NextResponse.json(
      { error: "Player already drafted" },
      { status: 400 },
    );
  }

  const meta = pickMeta(pickIndex, teams?.length ?? 1);

  const { data: inserted, error: insertError } = await svc
    .from("draft_picks")
    .insert({
      league_id,
      team_id,
      player_id,
      round: meta.round,
      pick_number: meta.pick_number,
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to insert pick" },
      { status: 500 },
    );
  }

  // Advance the on-the-clock pointer.
  const nextIndex = pickIndex + 1;
  const nextOnClock =
    nextIndex < totalPicks
      ? teamOnTheClock((teams ?? []) as Team[], nextIndex)
      : null;

  await svc
    .from("leagues")
    .update({
      draft_current_team: nextOnClock?.id ?? null,
      draft_round: nextOnClock
        ? pickMeta(nextIndex, teams!.length).round
        : league.draft_round,
      draft_status: nextOnClock ? "in_progress" : "complete",
      // Advance the stall-watch clock: the new on-clock team just
      // started their pick window, and we clear the "already
      // notified" marker so the fresh team is eligible for a stall
      // alert when their 15 minutes run out.
      draft_on_clock_since: nextOnClock ? new Date().toISOString() : null,
      draft_stale_notified_for: null,
    })
    .eq("id", league_id);

  // Fire a push notification to the new on-clock team's owner. We
  // await it rather than fire-and-forget because Vercel serverless
  // functions can terminate after the response returns and cancel
  // any background work. ~200-500ms per subscription isn't enough
  // to notice on top of the draft pick round-trip.
  if (nextOnClock?.owner_id && nextOnClock.owner_id !== user.id) {
    try {
      await sendPushToUser(nextOnClock.owner_id, {
        title: "🏒 You're on the clock!",
        body: `It's your pick in ${league.name}`,
        url: `/leagues/${league_id}/draft`,
        tag: `draft-${league_id}`,
      });
    } catch (err) {
      // Non-fatal: push is best-effort. Log and continue.
      console.error("sendPushToUser failed", err);
    }
  }

  return NextResponse.json({
    ok: true,
    round: meta.round,
    pick: meta.pick_number,
    inserted,
  });
}

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { randomizeDraftOrder } from "@/lib/draft";
import type { Team } from "@/lib/types";

/** Commissioner-only: assign a random snake draft order to the league's teams. */
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
    .select("id, commissioner_id, draft_status")
    .eq("id", leagueId)
    .single();
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.commissioner_id !== user.id) {
    return NextResponse.json({ error: "Commissioner only" }, { status: 403 });
  }
  if (league.draft_status !== "pending") {
    return NextResponse.json({ error: "Draft already started" }, { status: 409 });
  }

  const { data: teams } = await svc.from("teams").select("*").eq("league_id", leagueId);
  const shuffled = randomizeDraftOrder((teams ?? []) as Team[]);
  for (let i = 0; i < shuffled.length; i++) {
    await svc.from("teams").update({ draft_position: i + 1 }).eq("id", shuffled[i].id);
  }

  return NextResponse.json({ ok: true, order: shuffled.map((t) => t.name) });
}

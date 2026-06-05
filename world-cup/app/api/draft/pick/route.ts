import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { executePick, loadDraftState } from "@/lib/draft-server";

/**
 * Make a draft pick. Allowed if the signed-in user owns the team on the
 * clock, or is the league commissioner (so they can pick on someone's
 * behalf during an in-person draft).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}) as { leagueId?: string; countryId?: number });
  const leagueId = body.leagueId;
  const countryId = body.countryId;
  if (!leagueId || typeof countryId !== "number") {
    return NextResponse.json({ error: "leagueId and countryId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const state = await loadDraftState(svc, leagueId);
  if (!state.onClock) {
    return NextResponse.json({ error: "Draft is complete" }, { status: 409 });
  }

  const isCommish = state.league.commissioner_id === user.id;
  const ownsOnClock = state.onClock.owner_id === user.id;
  if (!isCommish && !ownsOnClock) {
    return NextResponse.json({ error: "It is not your turn" }, { status: 403 });
  }

  const result = await executePick(svc, leagueId, countryId, state.onClock.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true, complete: result.complete ?? false });
}

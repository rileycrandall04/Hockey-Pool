import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { executePick, loadDraftState, bestAvailableCountryId } from "@/lib/draft-server";

/**
 * Auto-pick the best available country (lowest FIFA rank) for the team on
 * the clock. Allowed for the on-clock owner or the commissioner.
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
  const state = await loadDraftState(svc, leagueId);
  if (!state.onClock) {
    return NextResponse.json({ error: "Draft is complete" }, { status: 409 });
  }

  const isCommish = state.league.commissioner_id === user.id;
  const ownsOnClock = state.onClock.owner_id === user.id;
  if (!isCommish && !ownsOnClock) {
    return NextResponse.json({ error: "It is not your turn" }, { status: 403 });
  }

  const poolSize = state.teams.length * state.league.roster_size;
  const countryId = await bestAvailableCountryId(svc, leagueId, poolSize);
  if (countryId == null) {
    return NextResponse.json({ error: "No countries available" }, { status: 409 });
  }

  const result = await executePick(svc, leagueId, countryId, state.onClock.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true, complete: result.complete ?? false });
}

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { computePoolOdds, type OddsCountry, type OddsRoster } from "@/lib/simulate-pool";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Commissioner-only: simulate the tournament many times from the drafted
 * rosters + FIFA ranks and store each team's probability of winning the pool.
 */
export async function POST(request: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: league } = await svc.from("leagues").select("commissioner_id, draft_status").eq("id", leagueId).single();
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.commissioner_id !== user.id) return NextResponse.json({ error: "Commissioner only" }, { status: 403 });
  if (league.draft_status !== "complete") return NextResponse.json({ error: "Finish the draft first" }, { status: 409 });

  const [{ data: countryRows }, { data: pickRows }] = await Promise.all([
    svc.from("countries").select("id, fifa_rank, group_letter"),
    svc.from("draft_picks").select("country_id, team_id").eq("league_id", leagueId),
  ]);

  const countries = (countryRows ?? []) as OddsCountry[];
  const byTeam = new Map<string, number[]>();
  for (const p of pickRows ?? []) {
    const arr = byTeam.get(p.team_id as string) ?? [];
    arr.push(p.country_id as number);
    byTeam.set(p.team_id as string, arr);
  }
  const rosters: OddsRoster[] = [...byTeam.entries()].map(([team_id, country_ids]) => ({ team_id, country_ids }));
  if (rosters.length === 0) return NextResponse.json({ error: "No drafted rosters" }, { status: 409 });

  const odds = computePoolOdds(countries, rosters);
  await svc.from("leagues").update({ odds, odds_computed_at: new Date().toISOString() }).eq("id", leagueId);

  return NextResponse.json({ ok: true, odds });
}

import { createServiceClient } from "@/lib/supabase/server";
import { fmtKickoff } from "@/lib/utils";
import { TickerClient, type TickerItem } from "@/components/ticker-client";
import type { Country, Match } from "@/lib/types";

/**
 * Server wrapper for the results ticker: loads recent finals + any live games
 * + the next few upcoming, and hands them to the marquee. Renders nothing
 * before the tournament has any matches.
 */
export async function Ticker({ leagueId }: { leagueId: string }) {
  const svc = createServiceClient();
  const [{ data: finals }, { data: live }, { data: upcoming }, { data: countryRows }] = await Promise.all([
    svc.from("matches").select("*").eq("status", "final").not("home_goals", "is", null).order("kickoff_utc", { ascending: false, nullsFirst: false }).limit(12),
    svc.from("matches").select("*").eq("status", "live"),
    svc.from("matches").select("*").eq("status", "scheduled").order("kickoff_utc", { ascending: true, nullsFirst: false }).limit(8),
    svc.from("countries").select("id, code, flag_url"),
  ]);

  const byId = new Map<string, Match>();
  for (const m of [...(finals ?? []), ...(live ?? []), ...(upcoming ?? [])] as Match[]) byId.set(m.id, m);
  const matches = [...byId.values()].sort((a, b) => (a.kickoff_utc ?? "").localeCompare(b.kickoff_utc ?? ""));
  if (matches.length === 0) return null;

  const country = new Map((countryRows ?? []).map((c) => [c.id as number, c as Country]));
  const items: TickerItem[] = matches.map((m) => {
    const h = country.get(m.home_country_id), a = country.get(m.away_country_id);
    const played = m.status === "final" && m.home_goals != null && m.away_goals != null;
    const center = played
      ? `${m.home_goals}–${m.away_goals}${m.went_to_shootout ? ` (${m.home_pens}-${m.away_pens})` : ""}`
      : m.status === "live"
        ? "LIVE"
        : fmtKickoff(m.kickoff_utc) || "v";
    return {
      matchId: m.id,
      homeCode: h?.code ?? "?",
      homeFlag: h?.flag_url ?? null,
      awayCode: a?.code ?? "?",
      awayFlag: a?.flag_url ?? null,
      center,
      live: m.status === "live",
    };
  });

  return <TickerClient leagueId={leagueId} items={items} />;
}

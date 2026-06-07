import { redirect } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { loadScorersByMatch } from "@/lib/match-scorers";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { ScorerList } from "@/components/scorer-list";
import type { Country, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  group: "Group", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal",
  sf: "Semifinal", third: "Third place", final: "Final",
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}
function kickoffTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { leagueId } = await params;
  const { date: dateParam } = await searchParams;
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const { league, isCommissioner, displayName } = access;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? dateParam! : ymd(new Date());
  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${addDays(date, 1)}T00:00:00Z`;

  const svc = createServiceClient();
  const [{ data: matchRows }, { data: countryRows }] = await Promise.all([
    svc.from("matches").select("*").gte("kickoff_utc", dayStart).lt("kickoff_utc", dayEnd).order("kickoff_utc"),
    svc.from("countries").select("id, name, code"),
  ]);
  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Country]));
  const matches = (matchRows ?? []) as Match[];
  const scorers = await loadScorersByMatch(svc, matches.map((m) => m.id));
  const today = ymd(new Date());

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <h1 className="mb-3 text-2xl font-bold text-ice-50">Schedule</h1>

        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-puck-border bg-puck-card px-3 py-2">
          <Link href={`/leagues/${leagueId}/schedule?date=${addDays(date, -1)}`} className="rounded px-2 py-1 text-ice-200 hover:bg-puck-border" aria-label="Previous day">←</Link>
          <div className="text-center">
            <div className="text-sm font-semibold text-ice-50">{prettyDate(date)}</div>
            {date !== today && (
              <Link href={`/leagues/${leagueId}/schedule`} className="text-[11px] text-ice-400 hover:underline">jump to today</Link>
            )}
          </div>
          <Link href={`/leagues/${leagueId}/schedule?date=${addDays(date, 1)}`} className="rounded px-2 py-1 text-ice-200 hover:bg-puck-border" aria-label="Next day">→</Link>
        </div>

        {matches.length === 0 ? (
          <p className="py-8 text-center text-sm text-ice-400">No matches on this day.</p>
        ) : (
          <div className="space-y-2">
            {matches.map((m) => {
              const home = countryById.get(m.home_country_id);
              const away = countryById.get(m.away_country_id);
              const played = m.status === "final" && m.home_goals != null && m.away_goals != null;
              return (
                <div key={m.id} className="rounded-md border border-puck-border bg-puck-bg p-3">
                  <Link href={`/leagues/${leagueId}/games/${m.id}`} className="group block">
                    <div className="mb-1 flex items-center justify-between text-xs text-ice-500">
                      <span className="uppercase tracking-wider group-hover:text-ice-300">{STAGE_LABEL[m.stage] ?? m.stage} →</span>
                      <span>{m.status === "live" ? "LIVE" : played ? "FT" : kickoffTime(m.kickoff_utc)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <Row country={home} />
                      <span className="px-2 text-ice-500">{played ? `${m.home_goals}–${m.away_goals}` : "v"}</span>
                      <Row country={away} alignRight />
                    </div>
                    {m.went_to_shootout && played && (
                      <div className="mt-1 text-center text-[11px] text-ice-400">
                        {m.home_pens}–{m.away_pens} on penalties
                      </div>
                    )}
                  </Link>
                  <ScorerList leagueId={leagueId} lines={scorers.get(m.id) ?? []} countryById={countryById} />
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

function Row({ country, alignRight }: { country?: Country; alignRight?: boolean }) {
  return (
    <span className={"flex flex-1 items-center gap-2 text-sm text-ice-100 " + (alignRight ? "flex-row-reverse text-right" : "")}>
      <Flag code={country?.code} />
      <span className="truncate">{country?.name ?? "TBD"}</span>
    </span>
  );
}

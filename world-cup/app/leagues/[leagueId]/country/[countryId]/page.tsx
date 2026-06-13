import { redirect } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { requireLeagueView } from "@/lib/league-access";
import { scoreCountry } from "@/lib/scoring";
import { loadScorersByMatch } from "@/lib/match-scorers";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { ScorerList } from "@/components/scorer-list";
import { LiveRefresher } from "@/components/live-refresher";
import { fmtPoints, fmtShortDate, liveClock } from "@/lib/utils";
import type { Country, Match, ScoringMatch } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  group: "Group", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal",
  sf: "Semifinal", third: "Third place", final: "Final",
};

export default async function CountryPage({
  params,
}: {
  params: Promise<{ leagueId: string; countryId: string }>;
}) {
  const { leagueId, countryId } = await params;
  const cid = Number(countryId);
  const access = await requireLeagueView(leagueId);
  const { league, isCommissioner, displayName, readOnly } = access;

  const svc = createServiceClient();
  const [{ data: countryRows }, { data: matchRows }] = await Promise.all([
    svc.from("countries").select("*"),
    svc.from("matches").select("*").or(`home_country_id.eq.${cid},away_country_id.eq.${cid}`).order("kickoff_utc", { nullsFirst: true }),
  ]);
  const countries = (countryRows ?? []) as Country[];
  const countryById = new Map(countries.map((c) => [c.id, c]));
  const me = countryById.get(cid);
  if (!me) redirect(`/leagues/${leagueId}/countries`);

  const matches = (matchRows ?? []) as Match[];
  const fifaRank = (id: number) => countryById.get(id)?.fifa_rank ?? null;
  const breakdown = scoreCountry(cid, matches as ScoringMatch[], fifaRank);
  const scorers = await loadScorersByMatch(svc, matches.map((m) => m.id));
  const anyLive = matches.some((m) => m.status === "live");

  return (
    <>
      {anyLive && <LiveRefresher />}
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} readOnly={readOnly} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <Flag code={me.code} url={me.flag_url} className="!h-6" />
          <div>
            <h1 className="text-2xl font-bold text-ice-50">{me.name}</h1>
            <p className="text-xs text-ice-400">
              {me.group_letter ? `Group ${me.group_letter}` : ""}
              {me.fifa_rank ? ` · FIFA #${me.fifa_rank}` : ""} · {fmtPoints(breakdown.total)} pool pts
              {breakdown.provisional_points !== 0 && (
                <span className="ml-1 font-medium text-amber-400">
                  · 🔴 {breakdown.provisional_points > 0 ? "+" : ""}
                  {fmtPoints(breakdown.provisional_points)} live
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Our-rules point breakdown */}
        <div className="mb-5 flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-puck-border bg-puck-card px-3 py-2 text-xs text-ice-400">
          <Stat label="Results" v={breakdown.match_points} />
          <Stat label="Goals for" v={breakdown.goals_for_points} />
          <Stat label="Goals against" v={breakdown.goals_against_points} />
          <Stat label="Clean sheets" v={breakdown.clean_sheet_points} />
          <Stat label="Upsets" v={breakdown.upset_points} />
          <Stat label="Advancement" v={breakdown.advancement_points} />
          <Stat label="Champion" v={breakdown.champion_points} />
          <Stat label="Runner-up" v={breakdown.runner_up_points} />
          <Stat label="3rd place" v={breakdown.third_place_points} />
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ice-400">Matches</h2>
        <div className="space-y-2">
          {matches.length === 0 && <p className="text-sm text-ice-400">No matches scheduled yet.</p>}
          {matches.map((m) => {
            const isHome = m.home_country_id === cid;
            const opp = countryById.get(isHome ? m.away_country_id : m.home_country_id);
            const myGoals = isHome ? m.home_goals : m.away_goals;
            const oppGoals = isHome ? m.away_goals : m.home_goals;
            const live = m.status === "live";
            const played = m.status === "final" && myGoals != null && oppGoals != null;
            const hasScore = (played || live) && myGoals != null && oppGoals != null;
            const resultColor = live ? "text-amber-300" : !played ? "text-ice-400" : myGoals! > oppGoals! ? "text-green-300" : myGoals! < oppGoals! ? "text-red-300" : "text-ice-200";
            return (
              <div
                key={m.id}
                className={
                  "rounded-md border bg-puck-bg p-3 " +
                  (live ? "border-red-500/40 ring-1 ring-red-500/20" : "border-puck-border")
                }
              >
                <Link href={`/leagues/${leagueId}/games/${m.id}`} className="group block">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-ice-500 group-hover:text-ice-300">
                      {STAGE_LABEL[m.stage] ?? m.stage}
                      {m.kickoff_utc ? ` · ${fmtShortDate(m.kickoff_utc)}` : ""} →
                    </span>
                    <span className={"flex items-center gap-1.5 text-sm font-semibold " + resultColor}>
                      {live && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                        </span>
                      )}
                      {hasScore ? `${myGoals} – ${oppGoals}` : "—"}
                      {live && <span className="text-[11px] font-medium text-red-300">{liveClock(m.status_detail, m.elapsed)}</span>}
                      {m.went_to_shootout && played ? ` (${isHome ? m.home_pens : m.away_pens}–${isHome ? m.away_pens : m.home_pens} pens)` : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-ice-100">
                    <span className="text-ice-400">vs</span>
                    <Flag code={opp?.code} url={opp?.flag_url} />
                    {opp?.name ?? "TBD"}
                  </div>
                </Link>
                <ScorerList leagueId={leagueId} lines={scorers.get(m.id) ?? []} countryById={countryById} />
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  if (!v) return null;
  return (
    <span>{label}: <span className="text-ice-200">{fmtPoints(v)}</span></span>
  );
}

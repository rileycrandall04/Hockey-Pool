import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { requireLeagueView } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { fmtKickoff, fmtShortDate } from "@/lib/utils";
import type { Country, Match, Stage } from "@/lib/types";

export const dynamic = "force-dynamic";

const ROUNDS: Array<{ stage: Stage; label: string }> = [
  { stage: "r32", label: "Round of 32" },
  { stage: "r16", label: "Round of 16" },
  { stage: "qf", label: "Quarterfinals" },
  { stage: "sf", label: "Semifinals" },
  { stage: "final", label: "Final" },
];

export default async function BracketPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const access = await requireLeagueView(leagueId);
  const { league, teams, isCommissioner, displayName, readOnly } = access;

  const svc = createServiceClient();
  const [{ data: matchRows }, { data: countryRows }, { data: pickRows }] = await Promise.all([
    svc.from("matches").select("*").neq("stage", "group").order("kickoff_utc", { nullsFirst: true }),
    svc.from("countries").select("id, name, code, flag_url"),
    svc.from("draft_picks").select("country_id, team_id").eq("league_id", leagueId),
  ]);

  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Country]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const ownerOf = new Map<number, string>();
  for (const p of pickRows ?? []) ownerOf.set(p.country_id as number, teamName.get(p.team_id as string) ?? "");

  const matches = (matchRows ?? []) as Match[];
  const byStage = (s: Stage) => matches.filter((m) => m.stage === s);
  const thirdPlace = byStage("third");

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} readOnly={readOnly} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="mb-1 text-2xl font-bold text-ice-50">Knockout bracket</h1>
        <p className="mb-4 text-xs text-ice-400">Tap any match for its point breakdown. Teams you can&rsquo;t see yet are still in the group stage.</p>

        {matches.length === 0 ? (
          <p className="text-sm text-ice-300">The knockout rounds appear here once the bracket is set (after the group stage).</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-3">
            {ROUNDS.map(({ stage, label }) => {
              const round = byStage(stage);
              if (round.length === 0) return null;
              return (
                <div key={stage} className="min-w-[220px] flex-1 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ice-400">{label}</div>
                  {round.map((m) => (
                    <MatchCard key={m.id} leagueId={leagueId} m={m} countryById={countryById} ownerOf={ownerOf} />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {thirdPlace.length > 0 && (
          <div className="mt-6 max-w-[260px]">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ice-400">Third-place playoff</div>
            {thirdPlace.map((m) => (
              <MatchCard key={m.id} leagueId={leagueId} m={m} countryById={countryById} ownerOf={ownerOf} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function MatchCard({
  leagueId,
  m,
  countryById,
  ownerOf,
}: {
  leagueId: string;
  m: Match;
  countryById: Map<number, Country>;
  ownerOf: Map<number, string>;
}) {
  const home = countryById.get(m.home_country_id);
  const away = countryById.get(m.away_country_id);
  const played = m.status === "final" && m.home_goals != null && m.away_goals != null;
  const homeWin = played && (m.home_goals! > m.away_goals! || (m.went_to_shootout && (m.home_pens ?? 0) > (m.away_pens ?? 0)));
  const awayWin = played && (m.away_goals! > m.home_goals! || (m.went_to_shootout && (m.away_pens ?? 0) > (m.home_pens ?? 0)));

  return (
    <Link
      href={`/leagues/${leagueId}/games/${m.id}`}
      className="block rounded-md border border-puck-border bg-puck-bg p-2 hover:border-ice-400"
    >
      {m.kickoff_utc && (
        <div className="mb-1 text-center text-[10px] uppercase tracking-wide text-ice-500">
          {fmtShortDate(m.kickoff_utc)} · {fmtKickoff(m.kickoff_utc)}
        </div>
      )}
      <TeamLine country={home} goals={played ? m.home_goals : null} win={homeWin} lose={awayWin} owner={home ? ownerOf.get(home.id) : ""} />
      <div className="my-1 h-px bg-puck-border" />
      <TeamLine country={away} goals={played ? m.away_goals : null} win={awayWin} lose={homeWin} owner={away ? ownerOf.get(away.id) : ""} />
      {m.went_to_shootout && played && (
        <div className="mt-1 text-center text-[10px] text-ice-500">{m.home_pens}–{m.away_pens} pens</div>
      )}
    </Link>
  );
}

function TeamLine({ country, goals, win, lose, owner }: { country?: Country; goals?: number | null; win?: boolean; lose?: boolean; owner?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Flag code={country?.code} url={country?.flag_url} className={lose ? "opacity-50" : ""} />
      <span className="flex-1 truncate text-sm">
        <span className={win ? "font-bold text-ice-50" : lose ? "text-ice-500 line-through" : "text-ice-200"}>
          {country?.name ?? "TBD"}
        </span>
        {owner ? <span className="ml-1 text-[10px] font-normal text-ice-500">· {owner}</span> : null}
      </span>
      <span className={"text-sm tabular-nums " + (win ? "font-bold text-ice-50" : lose ? "text-ice-500" : "text-ice-400")}>
        {goals ?? ""}
      </span>
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { isAppAdmin } from "@/lib/admin";
import { scoreCountry } from "@/lib/scoring";
import { loadScorersByMatch } from "@/lib/match-scorers";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { ScorerList } from "@/components/scorer-list";
import { fmtPoints } from "@/lib/utils";
import type { Country, Match, ScoredCountry, ScoringMatch } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  group: "Group stage", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal",
  sf: "Semifinal", third: "Third-place playoff", final: "Final",
};

/** Per-match point contribution (excludes one-time advancement/champion bonuses). */
function matchPoints(s: ScoredCountry): number {
  return s.match_points + s.goals_for_points + s.goals_against_points + s.clean_sheet_points + s.upset_points;
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ leagueId: string; matchId: string }>;
}) {
  const { leagueId, matchId } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const { league, isCommissioner, displayName } = access;

  const svc = createServiceClient();
  const { data: match } = await svc.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (!match) redirect(`/leagues/${leagueId}/schedule`);
  const m = match as Match;

  const { data: countryRows } = await svc.from("countries").select("*");
  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Country]));
  const fifaRank = (id: number) => countryById.get(id)?.fifa_rank ?? null;
  const home = countryById.get(m.home_country_id);
  const away = countryById.get(m.away_country_id);

  const scorers = await loadScorersByMatch(svc, [m.id]);
  const canEditGoals = await isAppAdmin(svc, user.id, user.email);
  const played = m.status === "final" && m.home_goals != null && m.away_goals != null;
  const homeScore = scoreCountry(m.home_country_id, [m as ScoringMatch], fifaRank);
  const awayScore = scoreCountry(m.away_country_id, [m as ScoringMatch], fifaRank);

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        {canEditGoals && (
          <div className="mb-2 text-right">
            <Link href={`/leagues/${leagueId}/admin/goals/${m.id}`} className="text-xs text-ice-400 hover:underline">
              ✍️ Edit goals
            </Link>
          </div>
        )}
        <div className="mb-2 text-center text-xs uppercase tracking-wider text-ice-500">
          {STAGE_LABEL[m.stage] ?? m.stage}
        </div>
        <div className="mb-4 flex items-center justify-center gap-4">
          <TeamHead leagueId={leagueId} country={home} />
          <div className="text-center">
            <div className="text-3xl font-bold text-ice-50">
              {played ? `${m.home_goals} – ${m.away_goals}` : m.status === "live" ? "LIVE" : "vs"}
            </div>
            {m.went_to_shootout && played && (
              <div className="text-[11px] text-ice-400">{m.home_pens}–{m.away_pens} pens</div>
            )}
          </div>
          <TeamHead leagueId={leagueId} country={away} alignRight />
        </div>

        {(scorers.get(m.id)?.length ?? 0) > 0 && (
          <div className="mb-5 rounded-md border border-puck-border bg-puck-card p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ice-400">Scorers</div>
            <ScorerList leagueId={leagueId} lines={scorers.get(m.id) ?? []} countryById={countryById} />
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ice-400">Pool points from this match</h2>
        {!played ? (
          <p className="text-sm text-ice-400">Not played yet — points appear once the match is final.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Breakdown country={home} s={homeScore} />
            <Breakdown country={away} s={awayScore} />
          </div>
        )}
      </main>
    </>
  );
}

function TeamHead({ leagueId, country, alignRight }: { leagueId: string; country?: Country; alignRight?: boolean }) {
  if (!country) return <div className="flex-1 text-center text-ice-400">TBD</div>;
  return (
    <Link
      href={`/leagues/${leagueId}/country/${country.id}`}
      className={"flex flex-1 flex-col items-center gap-1 hover:underline " + (alignRight ? "" : "")}
    >
      <Flag code={country.code} className="!w-9 !h-7" />
      <span className="text-center text-sm font-semibold text-ice-50">{country.name}</span>
    </Link>
  );
}

function Breakdown({ country, s }: { country?: Country; s: ScoredCountry }) {
  const rows: Array<[string, number]> = [
    ["Result", s.match_points],
    ["Goals for", s.goals_for_points],
    ["Goals against", s.goals_against_points],
    ["Clean sheet", s.clean_sheet_points],
    ["Upset", s.upset_points],
  ];
  return (
    <div className="rounded-md border border-puck-border bg-puck-bg p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ice-50">
        <Flag code={country?.code} /> {country?.code ?? "?"}
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([label, v]) => (
            <tr key={label} className={v === 0 ? "text-ice-500" : "text-ice-300"}>
              <td className="py-0.5">{label}</td>
              <td className="py-0.5 text-right">{v > 0 ? `+${fmtPoints(v)}` : fmtPoints(v)}</td>
            </tr>
          ))}
          <tr className="border-t border-puck-border font-semibold text-ice-50">
            <td className="py-1">Match total</td>
            <td className="py-1 text-right">{fmtPoints(matchPoints(s))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { computeStandings } from "@/lib/standings";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { RecentResults } from "@/components/recent-results";
import { GoldenBootRace } from "@/components/golden-boot-race";
import { GoldenBootIcon } from "@/components/golden-boot-icon";
import { TodaysGames } from "@/components/todays-games";
import { LiveRefresher } from "@/components/live-refresher";
import { loadScorersByMatch, type ScorerLine } from "@/lib/match-scorers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtPoints, poolToday, POOL_TZ_OFFSET } from "@/lib/utils";
import type { Country, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LeagueStandingsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const user = await getUser();
  if (!user) redirect("/login");

  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");

  const { league, teams, ownerNames, isCommissioner, displayName, myTeam } = access;
  const svc = createServiceClient();
  const rows = await computeStandings(svc, leagueId, teams, ownerNames);

  const drafted = league.draft_status === "complete";
  const anyLive = rows.some((r) => r.scored.provisional_points !== 0);

  // Today's fixtures (Mountain-Time day boundaries), for the scoreboard card.
  const today = poolToday();
  const dEnd = new Date(`${today}T00:00:00Z`);
  dEnd.setUTCDate(dEnd.getUTCDate() + 1);
  const dayStart = `${today}T00:00:00${POOL_TZ_OFFSET}`;
  const dayEnd = `${dEnd.toISOString().slice(0, 10)}T00:00:00${POOL_TZ_OFFSET}`;
  const { data: todayRows } = await svc
    .from("matches")
    .select("*")
    .gte("kickoff_utc", dayStart)
    .lt("kickoff_utc", dayEnd)
    .order("kickoff_utc");
  const todaysGames = (todayRows ?? []) as Match[];
  let todayCountries = new Map<number, Country>();
  let todayScorers = new Map<string, ScorerLine[]>();
  if (todaysGames.length > 0) {
    const ids = [...new Set(todaysGames.flatMap((m) => [m.home_country_id, m.away_country_id]))];
    const [{ data: cs }, scorerMap] = await Promise.all([
      svc.from("countries").select("id, name, code, flag_url").in("id", ids),
      loadScorersByMatch(svc, todaysGames.map((m) => m.id)),
    ]);
    todayCountries = new Map((cs ?? []).map((c) => [c.id as number, c as Country]));
    todayScorers = scorerMap;
  }
  const anyLiveToday = todaysGames.some((m) => m.status === "live");

  return (
    <>
      <NavBar
        displayName={displayName}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
      />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-ice-50">{league.name}</h1>
            <p className="text-xs text-ice-400">
              Season {league.season} · {league.draft_status.replace("_", " ")}
            </p>
          </div>
          {league.draft_status !== "complete" && (
            <Link href={`/leagues/${leagueId}/draft`}>
              <Button size="sm">
                {league.draft_status === "pending" ? "To draft lobby" : "Go to draft"}
              </Button>
            </Link>
          )}
        </div>

        {!drafted && (
          <div className="mb-4 rounded-md border border-puck-border bg-puck-card px-4 py-3 text-sm text-ice-300">
            The draft isn&rsquo;t finished yet, so totals are all zero. Standings
            come alive once matches are scored.
          </div>
        )}

        {anyLive && (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            🔴 Games in progress — totals include <strong>provisional</strong> live points (results,
            goals, clean sheets). They lock in when each match goes final.
          </div>
        )}

        {todaysGames.length > 0 && (
          <div className="mb-4">
            {anyLiveToday && <LiveRefresher />}
            <TodaysGames leagueId={leagueId} games={todaysGames} countryById={todayCountries} scorers={todayScorers} />
          </div>
        )}

        {teams.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-ice-300">
              No teams yet. Share the join code{" "}
              <span className="font-mono text-ice-50">{league.join_code}</span>.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-puck-border">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-puck-card text-left text-xs uppercase tracking-wider text-ice-400">
                <tr>
                  <th className="px-2 py-2 sm:px-3">#</th>
                  <th className="px-2 py-2 sm:px-3">Team</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Countries</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">GF</th>
                  <th className="px-2 py-2 text-right sm:px-3">Pts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isMe = myTeam?.id === row.team.id;
                  const chips = () =>
                    row.countries.length === 0 ? (
                      <span className="text-xs text-ice-500">—</span>
                    ) : (
                      row.countries.map(({ country }) =>
                        country ? (
                          <span
                            key={country.id}
                            className="inline-flex items-center gap-1 rounded bg-puck-card px-1.5 py-0.5 text-xs text-ice-200"
                            title={country.name}
                          >
                            <Flag code={country.code} url={country.flag_url} />
                            {country.code}
                          </span>
                        ) : null,
                      )
                    );
                  return (
                    <tr
                      key={row.team.id}
                      className={
                        "border-t border-puck-border " +
                        (isMe ? "bg-ice-500/10" : "bg-puck-bg")
                      }
                    >
                      <td className="px-2 py-2 text-ice-400 sm:px-3">{i + 1}</td>
                      <td className="px-2 py-2 sm:px-3">
                        <Link
                          href={`/leagues/${leagueId}/team/${row.team.id}`}
                          className="font-semibold text-ice-50 hover:underline"
                        >
                          {row.team.name}
                        </Link>
                        {row.scored.golden_boot_points > 0 && (
                          <span title="Holds the Golden Boot bonus"> <GoldenBootIcon /></span>
                        )}
                        <div className="text-xs text-ice-400">{row.ownerName}</div>
                        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">{chips()}</div>
                      </td>
                      <td className="hidden px-3 py-2 sm:table-cell">
                        <div className="flex flex-wrap gap-1">{chips()}</div>
                      </td>
                      <td className="hidden px-3 py-2 text-right text-ice-300 sm:table-cell">
                        {row.scored.tiebreak.goals_for}
                      </td>
                      <td className="px-2 py-2 text-right sm:px-3">
                        <div className="font-semibold text-ice-50">{fmtPoints(row.scored.total)}</div>
                        {row.scored.provisional_points !== 0 && (
                          <div className="text-[10px] font-medium text-amber-400">
                            🔴 {row.scored.provisional_points > 0 ? "+" : ""}
                            {fmtPoints(row.scored.provisional_points)} live
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        <GoldenBootRace leagueId={leagueId} />
        <div className="mt-6">
          <RecentResults leagueId={leagueId} />
        </div>
      </main>
    </>
  );
}

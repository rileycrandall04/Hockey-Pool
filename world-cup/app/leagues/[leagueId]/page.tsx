import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { computeStandings } from "@/lib/standings";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtPoints } from "@/lib/utils";

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

        {teams.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-ice-300">
              No teams yet. Share the join code{" "}
              <span className="font-mono text-ice-50">{league.join_code}</span>.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-puck-border">
            <table className="w-full text-sm">
              <thead className="bg-puck-card text-left text-xs uppercase tracking-wider text-ice-400">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Countries</th>
                  <th className="px-3 py-2 text-right">GF</th>
                  <th className="px-3 py-2 text-right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isMe = myTeam?.id === row.team.id;
                  return (
                    <tr
                      key={row.team.id}
                      className={
                        "border-t border-puck-border " +
                        (isMe ? "bg-ice-500/10" : "bg-puck-bg")
                      }
                    >
                      <td className="px-3 py-2 text-ice-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/leagues/${leagueId}/team/${row.team.id}`}
                          className="font-semibold text-ice-50 hover:underline"
                        >
                          {row.team.name}
                        </Link>
                        <div className="text-xs text-ice-400">{row.ownerName}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.countries.map(({ country }) =>
                            country ? (
                              <span
                                key={country.id}
                                className="inline-flex items-center gap-1 rounded bg-puck-card px-1.5 py-0.5 text-xs text-ice-200"
                                title={country.name}
                              >
                                <Flag code={country.code} />
                                {country.code}
                              </span>
                            ) : null,
                          )}
                          {row.countries.length === 0 && (
                            <span className="text-xs text-ice-500">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-ice-300">
                        {row.scored.tiebreak.goals_for}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-ice-50">
                        {fmtPoints(row.scored.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

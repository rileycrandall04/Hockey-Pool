import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreTeam } from "@/lib/scoring";
import type { League, RosterEntry, Team } from "@/lib/types";

export default async function LeagueStandingsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single<League>();
  if (!league) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .eq("league_id", leagueId);

  const { data: rosterRows } = await supabase
    .from("v_team_rosters")
    .select("*")
    .eq("league_id", leagueId);

  const { data: adjustments } = await supabase
    .from("score_adjustments")
    .select("team_id, delta_points")
    .eq("league_id", leagueId);

  const adjByTeam = new Map<string, number>();
  for (const a of adjustments ?? []) {
    adjByTeam.set(
      a.team_id ?? "",
      (adjByTeam.get(a.team_id ?? "") ?? 0) + a.delta_points,
    );
  }

  const rosterByTeam = new Map<string, RosterEntry[]>();
  for (const row of (rosterRows as RosterEntry[] | null) ?? []) {
    const arr = rosterByTeam.get(row.team_id) ?? [];
    arr.push(row);
    rosterByTeam.set(row.team_id, arr);
  }

  const standings = (teams ?? [])
    .map((t: Team) => {
      const roster = rosterByTeam.get(t.id) ?? [];
      const scored = scoreTeam(roster, {
        rosterSize: league.roster_size,
        scoringRosterSize: league.scoring_roster_size,
        requiredDefensemen: league.required_defensemen,
      });
      const adj = adjByTeam.get(t.id) ?? 0;
      return {
        team: t,
        total: scored.totalPoints + adj,
        scoringCount: scored.scoring.length,
        benchCount: scored.bench.length,
        adjustment: adj,
      };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-ice-50">{league.name}</h1>
            <p className="text-sm text-ice-300">
              Season {league.season} &middot; Join code{" "}
              <span className="rounded bg-puck-card px-1.5 py-0.5 font-mono text-ice-100">
                {league.join_code}
              </span>{" "}
              &middot; Draft: {league.draft_status.replace("_", " ")}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/leagues/${league.id}/draft`}>
              <Button size="sm" variant="secondary">
                Draft room
              </Button>
            </Link>
            {league.commissioner_id === user.id && (
              <Link href={`/leagues/${league.id}/admin`}>
                <Button size="sm" variant="ghost">
                  Admin
                </Button>
              </Link>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Standings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-puck-border text-left text-ice-300">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Team</th>
                  <th className="px-4 py-3 text-right">Scoring</th>
                  <th className="px-4 py-3 text-right">Adj.</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {standings.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-ice-400"
                    >
                      No teams yet. Share your join code{" "}
                      <span className="font-mono text-ice-200">
                        {league.join_code}
                      </span>
                      .
                    </td>
                  </tr>
                ) : (
                  standings.map((row, i) => (
                    <tr
                      key={row.team.id}
                      className="border-b border-puck-border last:border-0"
                    >
                      <td className="px-4 py-3 text-ice-400">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-ice-50">
                        {row.team.name}
                      </td>
                      <td className="px-4 py-3 text-right text-ice-300">
                        {row.scoringCount}/{league.roster_size}
                      </td>
                      <td className="px-4 py-3 text-right text-ice-300">
                        {row.adjustment >= 0 ? `+${row.adjustment}` : row.adjustment}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-ice-50">
                        {row.total}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/leagues/${league.id}/team/${row.team.id}`}
                          className="text-ice-400 hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

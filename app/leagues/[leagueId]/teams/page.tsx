import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DailyTicker } from "@/components/daily-ticker";
import { scoreTeam } from "@/lib/scoring";
import type { League, RosterEntry, Team } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * "Teams" view shown post-draft. Lists every team in the league with
 * its full roster always expanded (no dropdowns), each player linked
 * to their detail page. Sister of the standings page, but designed
 * for "show me everyone's lineup" rather than "who's winning".
 *
 * The navbar's Draft button morphs to "Teams" and points here once
 * league.draft_status === "complete".
 */
export default async function LeagueTeamsPage({
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

  const league = await getLeagueForMember(supabase, leagueId, user.id);
  if (!league) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: teams } = await supabase
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .order("name");

  const [{ data: rosterRows }, { data: nhlTeamRows }] = await Promise.all([
    supabase
      .from("v_team_rosters")
      .select("*")
      .eq("league_id", leagueId),
    supabase
      .from("nhl_teams")
      .select("abbrev, logo_url"),
  ]);

  const logoByAbbrev = new Map<string, string>();
  for (const t of nhlTeamRows ?? []) {
    if (t.logo_url) logoByAbbrev.set(t.abbrev, t.logo_url);
  }

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

  // For each team: compute scored vs bench, then sort BOTH by playoff
  // pool points desc.
  const teamCards = (teams ?? [])
    .map((t: Team) => {
      const roster = rosterByTeam.get(t.id) ?? [];
      const scored = scoreTeam(roster, {
        rosterSize: league.roster_size,
        scoringRosterSize: league.scoring_roster_size,
        requiredDefensemen: league.required_defensemen,
      });
      const adj = adjByTeam.get(t.id) ?? 0;
      const byPlayoffPts = (a: RosterEntry, b: RosterEntry) => {
        if (b.fantasy_points !== a.fantasy_points)
          return b.fantasy_points - a.fantasy_points;
        return b.games_played - a.games_played;
      };
      return {
        team: t,
        total: scored.totalPoints + adj,
        adjustment: adj,
        scoring: [...scored.scoring].sort(byPlayoffPts),
        bench: [...scored.bench].sort(byPlayoffPts),
      };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={league.commissioner_id === user.id}
      />
      <DailyTicker />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <Link
            href={`/leagues/${leagueId}`}
            className="text-sm text-ice-400 hover:underline"
          >
            ← {league.name}
          </Link>
          <h1 className="text-3xl font-bold text-ice-50">Teams</h1>
          <p className="text-sm text-ice-300">
            Full rosters for every team in {league.name}, sorted by
            current pool points. The line above each team&rsquo;s bench
            section marks the cut between scoring players (top{" "}
            {league.scoring_roster_size} with at least{" "}
            {league.required_defensemen} D) and the bench.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {teamCards.map((row) => (
            <Card key={row.team.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{row.team.name}</CardTitle>
                  <span className="text-2xl font-bold text-ice-50">
                    {row.total}
                    <span className="ml-1 text-xs font-normal uppercase text-ice-400">
                      pts
                    </span>
                  </span>
                </div>
                <CardDescription>
                  {row.scoring.length}/{league.roster_size} scoring &middot;{" "}
                  {row.bench.length} bench
                  {row.adjustment !== 0 && (
                    <>
                      {" "}
                      &middot; adjustment{" "}
                      <span
                        className={
                          row.adjustment >= 0
                            ? "text-green-300"
                            : "text-red-300"
                        }
                      >
                        {row.adjustment >= 0 ? "+" : ""}
                        {row.adjustment}
                      </span>
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {row.scoring.length === 0 ? (
                  <p className="text-sm text-ice-400">
                    No players drafted yet.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {row.scoring.map((p) => (
                      <PlayerLine key={p.player_id} p={p} logoByAbbrev={logoByAbbrev} />
                    ))}
                    {row.bench.length > 0 && (
                      <>
                        <li className="my-2 border-t border-dashed border-puck-border" />
                        <li className="mb-1 text-[10px] uppercase tracking-wider text-ice-500">
                          Bench &middot; not counted
                        </li>
                        {row.bench.map((p) => (
                          <PlayerLine key={p.player_id} p={p} muted logoByAbbrev={logoByAbbrev} />
                        ))}
                      </>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </>
  );
}

function PlayerLine({
  p,
  muted = false,
  logoByAbbrev,
}: {
  p: RosterEntry;
  muted?: boolean;
  logoByAbbrev: Map<string, string>;
}) {
  const logo = p.nhl_abbrev ? logoByAbbrev.get(p.nhl_abbrev) : undefined;
  return (
    <li>
      <Link
        href={`/players/${p.player_id}`}
        className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-puck-border/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={
              p.position === "D"
                ? "rounded bg-ice-500/20 px-1 text-[10px] font-semibold text-ice-200"
                : "rounded bg-puck-border px-1 text-[10px] text-ice-300"
            }
          >
            {p.position}
          </span>
          {logo ? (
            <img src={logo} alt="" className="h-5 w-5 flex-shrink-0 object-contain" />
          ) : (
            <span className="inline-block h-5 w-5 flex-shrink-0 rounded bg-puck-border/40" />
          )}
          <span
            className={`truncate ${muted ? "text-ice-400" : "text-ice-100"}`}
          >
            {p.full_name}
          </span>
        </span>
        <span
          className={`flex-shrink-0 font-semibold ${muted ? "text-ice-400" : "text-ice-50"}`}
        >
          {p.fantasy_points}
        </span>
      </Link>
    </li>
  );
}

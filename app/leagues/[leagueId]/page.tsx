import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreTeam } from "@/lib/scoring";
import type { League, RosterEntry, Team } from "@/lib/types";

/**
 * Server action: the current user removes their team from this league.
 *
 * Rules:
 *   - Must be authenticated.
 *   - Must currently own a team in this league.
 *   - Cannot be the commissioner — commissioners must delete the
 *     whole league instead.
 *   - Cannot leave during an active draft (would break snake order
 *     mid-pick). They must wait until the draft completes or ask the
 *     commissioner to reset it.
 *
 * Effect:
 *   - Deletes the user's `teams` row, which cascades to `draft_picks`
 *     and `score_adjustments` for that team via the existing FKs.
 *   - Players the team had drafted (if the draft was complete) become
 *     immediately draftable again because the per-league draft pool is
 *     defined as "players not in any draft_picks row for this league".
 *   - Other teams in the league are untouched.
 */
async function leaveLeagueAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (confirm !== "LEAVE") {
    redirect(
      `/leagues/${leagueId}?leave_error=${encodeURIComponent("Type LEAVE to confirm.")}`,
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("commissioner_id, draft_status")
    .eq("id", leagueId)
    .single();

  if (!league) {
    redirect(
      `/dashboard?leave_error=${encodeURIComponent("League not found.")}`,
    );
  }

  if (league.commissioner_id === user.id) {
    redirect(
      `/leagues/${leagueId}?leave_error=${encodeURIComponent(
        "Commissioners must delete the league instead of leaving.",
      )}`,
    );
  }

  if (league.draft_status === "in_progress") {
    redirect(
      `/leagues/${leagueId}?leave_error=${encodeURIComponent(
        "Cannot leave during an active draft. Wait for the draft to finish or ask the commissioner to reset it.",
      )}`,
    );
  }

  const { error } = await svc
    .from("teams")
    .delete()
    .eq("league_id", leagueId)
    .eq("owner_id", user.id);

  if (error) {
    redirect(
      `/leagues/${leagueId}?leave_error=${encodeURIComponent(error.message)}`,
    );
  }

  redirect(
    `/dashboard?left=${encodeURIComponent("You left the league. Your players are back in the draft pool.")}`,
  );
}

export default async function LeagueStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ leave_error?: string }>;
}) {
  const { leagueId } = await params;
  const { leave_error } = await searchParams;
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

  const myTeam = (teams ?? []).find((t) => t.owner_id === user.id) ?? null;
  const isCommissioner = league.commissioner_id === user.id;
  const canLeave = myTeam !== null && !isCommissioner;

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

        {leave_error && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {leave_error}
          </div>
        )}

        {canLeave && (
          <Card
            id="leave-league"
            className="mt-6 scroll-mt-24 border-red-500/30 bg-red-500/5"
          >
            <CardHeader>
              <CardTitle className="text-red-300">Leave league</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-ice-400">
                Removes <strong>{myTeam?.name}</strong> from this league.
                Other teams stay exactly as they are. Any players you
                drafted go back into the pool. Allowed before the draft
                starts and after it&rsquo;s complete &mdash; not during
                an active draft.
              </p>
              <form
                action={leaveLeagueAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="league_id" value={leagueId} />
                <div className="space-y-1">
                  <Label htmlFor="leave_confirm">
                    Type <span className="font-mono">LEAVE</span> to confirm
                  </Label>
                  <Input
                    id="leave_confirm"
                    name="confirm"
                    placeholder="LEAVE"
                    className="max-w-[180px] font-mono"
                  />
                </div>
                <Button
                  type="submit"
                  variant="danger"
                  disabled={league.draft_status === "in_progress"}
                >
                  Leave league
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

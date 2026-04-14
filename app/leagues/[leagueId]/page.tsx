import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyTicker } from "@/components/daily-ticker";
import { scoreTeam } from "@/lib/scoring";
import { getOvernightDeltas } from "@/lib/snapshot-standings";
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

  // Overnight deltas for the up/down/fire indicators. Returns null
  // until we have at least two snapshot dates for this league.
  const overnight = await getOvernightDeltas(leagueId);
  const deltas = overnight?.deltas ?? null;
  const leagueAvgDelta = overnight?.leagueAvgDeltaPoints ?? 0;
  // "Hot" threshold: scored >= 130% of the league average overnight.
  // Require the league to actually have scored something so a zero
  // average doesn't light every team up.
  const hotThreshold = leagueAvgDelta > 0 ? leagueAvgDelta * 1.3 : null;

  // For each team: compute the scored lineup + bench, then sort BOTH
  // by playoff fantasy points desc so the dropdown view shows them in
  // pool-points order (highest contributors first, lowest at the
  // bottom of the bench section). The visual separator is just the
  // CSS divider between the two arrays.
  const standings = (teams ?? [])
    .map((t: Team) => {
      const roster = rosterByTeam.get(t.id) ?? [];
      const scored = scoreTeam(roster, {
        rosterSize: league.roster_size,
        scoringRosterSize: league.scoring_roster_size,
        requiredDefensemen: league.required_defensemen,
      });
      const adj = adjByTeam.get(t.id) ?? 0;
      // Re-sort each section by playoff fantasy points (desc), with
      // games_played as a tiebreak. scoreTeam already does this for
      // the scoring list but the bench is in arbitrary order.
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
        isCommissioner={isCommissioner}
      />
      <DailyTicker />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-bold text-ice-50">{league.name}</h1>
          <p className="text-sm text-ice-300">
            Season {league.season} &middot; Join code{" "}
            <span className="rounded bg-puck-card px-1.5 py-0.5 font-mono text-ice-100">
              {league.join_code}
            </span>{" "}
            &middot; Draft: {league.draft_status.replace("_", " ")}
          </p>
          {league.draft_status !== "complete" && (
            <Link href={`/leagues/${league.id}/draft`}>
              <Button size="sm" variant="secondary">
                Draft room
              </Button>
            </Link>
          )}
        </div>

        {standings.length === 0 ? (
          <Card>
            <CardContent className="px-4 py-6 text-center text-ice-400">
              No teams yet. Share your join code{" "}
              <span className="font-mono text-ice-200">
                {league.join_code}
              </span>
              .
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {standings.map((row, i) => {
              const delta = deltas?.get(row.team.id) ?? null;
              const movedUp = delta ? delta.delta_rank > 0 : false;
              const movedDown = delta ? delta.delta_rank < 0 : false;
              const hot =
                delta != null &&
                hotThreshold != null &&
                delta.delta_points >= hotThreshold &&
                delta.delta_points > 0;
              const rankTitle = delta
                ? `Was #${delta.rank_from} yesterday (${delta.delta_points >= 0 ? "+" : ""}${delta.delta_points} pts overnight)`
                : undefined;
              return (
              <details
                key={row.team.id}
                className="group rounded-md border border-puck-border bg-puck-card"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 hover:bg-puck-border/40 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-block w-4 text-right text-ice-400 transition-transform group-open:rotate-90">
                      ▶
                    </span>
                    <span className="text-ice-400">{i + 1}.</span>
                    {movedUp && (
                      <span
                        title={rankTitle}
                        aria-label="Moved up overnight"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-green-500/20 text-[10px] font-bold text-green-300"
                      >
                        ▲
                      </span>
                    )}
                    {movedDown && (
                      <span
                        title={rankTitle}
                        aria-label="Moved down overnight"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-red-500/20 text-[10px] font-bold text-red-300"
                      >
                        ▼
                      </span>
                    )}
                    <span className="truncate font-medium text-ice-50">
                      {row.team.name}
                    </span>
                    {hot && (
                      <span
                        title={`Hot streak: +${delta?.delta_points} pts overnight, ${leagueAvgDelta.toFixed(1)} avg`}
                        aria-label="On a hot streak"
                        className="flex-shrink-0"
                      >
                        🔥
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-lg font-bold text-ice-50">
                    {row.total}
                    <span className="ml-1 text-xs font-normal uppercase text-ice-400">
                      pts
                    </span>
                  </span>
                </summary>
                <div className="border-t border-puck-border px-4 py-3 text-sm">
                  {row.scoring.length === 0 ? (
                    <p className="text-ice-400">No players drafted yet.</p>
                  ) : (
                    <RosterList
                      players={row.scoring}
                      footerPlayers={row.bench}
                      adjustment={row.adjustment}
                    />
                  )}
                </div>
              </details>
              );
            })}
          </div>
        )}

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

/**
 * Renders a team's roster inside the standings dropdown.
 *
 * - Top section: scoring lineup (counts toward total). Each player
 *   is a clickable link to /players/[id].
 * - Visible separator line.
 * - Bottom section: bench (does NOT count toward total). Same layout.
 * - If the team has any commissioner score adjustments, summarize
 *   the net delta below the bench so users can see why the headline
 *   total doesn't equal the sum of the listed players.
 */
function RosterList({
  players,
  footerPlayers,
  adjustment,
}: {
  players: RosterEntry[];
  footerPlayers: RosterEntry[];
  adjustment: number;
}) {
  return (
    <div className="space-y-1">
      {players.map((p) => (
        <PlayerRow key={p.player_id} p={p} />
      ))}
      {footerPlayers.length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-puck-border" />
          <p className="mb-1 text-[10px] uppercase tracking-wider text-ice-500">
            Bench &middot; not counted
          </p>
          {footerPlayers.map((p) => (
            <PlayerRow key={p.player_id} p={p} muted />
          ))}
        </>
      )}
      {adjustment !== 0 && (
        <div className="mt-2 border-t border-puck-border pt-2 text-xs text-ice-300">
          Commissioner adjustment:{" "}
          <span
            className={
              adjustment >= 0 ? "text-green-300" : "text-red-300"
            }
          >
            {adjustment >= 0 ? "+" : ""}
            {adjustment} pts
          </span>
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  p,
  muted = false,
}: {
  p: RosterEntry;
  muted?: boolean;
}) {
  return (
    <Link
      href={`/players/${p.player_id}`}
      className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-puck-border/40"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={
            p.position === "D"
              ? "rounded bg-ice-500/20 px-1 text-[10px] font-semibold text-ice-200"
              : "rounded bg-puck-border px-1 text-[10px] text-ice-300"
          }
        >
          {p.position}
        </span>
        <span
          className={`truncate ${muted ? "text-ice-400" : "text-ice-100"}`}
        >
          {p.full_name}
        </span>
        <span className="text-[10px] text-ice-500">
          {p.nhl_abbrev ?? "—"}
        </span>
      </span>
      <span
        className={`flex-shrink-0 font-semibold ${muted ? "text-ice-400" : "text-ice-50"}`}
      >
        {p.fantasy_points}
      </span>
    </Link>
  );
}

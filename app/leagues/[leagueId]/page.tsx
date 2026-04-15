import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Force dynamic rendering so Next.js never serves a cached version
// of this page that's missing the just-deployed watch toggle (or
// any other header additions). Auth + Supabase queries make this
// effectively dynamic anyway, but being explicit guarantees it.
export const dynamic = "force-dynamic";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyJoinCodeButton } from "@/components/copy-join-code-button";
import { DailyTicker } from "@/components/daily-ticker";
import { TonightsGames } from "@/components/tonights-games";
import { scoreTeam } from "@/lib/scoring";
import { getOvernightDeltas } from "@/lib/snapshot-standings";
import type {
  League,
  PlayoffGame,
  PlayoffSeries,
  RosterEntry,
  Team,
} from "@/lib/types";

/**
 * Server action that flips draft stall alerts on/off for the
 * current user + this league. Same logic as the dashboard toggle
 * (migration 0009's draft_watches table), lifted here so users can
 * opt in directly from the league they're viewing instead of
 * navigating out to the global dashboard first.
 */
async function toggleDraftWatchAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!leagueId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (action === "watch") {
    await supabase
      .from("draft_watches")
      .upsert(
        {
          user_id: user.id,
          league_id: leagueId,
          stale_minutes: 15,
        },
        { onConflict: "user_id,league_id" },
      );
  } else if (action === "unwatch") {
    await supabase
      .from("draft_watches")
      .delete()
      .eq("user_id", user.id)
      .eq("league_id", leagueId);
  }

  revalidatePath(`/leagues/${leagueId}`);
  redirect(`/leagues/${leagueId}`);
}

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

  const isCommissioner = league.commissioner_id === user.id;

  const { data: rosterRows } = await supabase
    .from("v_team_rosters")
    .select("*")
    .eq("league_id", leagueId);

  const { data: adjustments } = await supabase
    .from("score_adjustments")
    .select("team_id, delta_points")
    .eq("league_id", leagueId);

  // Bracket data is global (not league-scoped). It's refreshed nightly
  // by the stats cron. On the league home we only surface the compact
  // "tonight's games" card; the full bracket tree lives at
  // /leagues/{id}/bracket so the standings stays the focus here.
  const { data: bracketSeriesRows } = await supabase
    .from("playoff_series")
    .select("*")
    .order("round", { ascending: true })
    .order("sort_order", { ascending: true });
  const { data: bracketGameRows } = await supabase
    .from("playoff_games")
    .select("*")
    .order("start_time_utc", { ascending: true });
  const bracketSeries = (bracketSeriesRows ?? []) as PlayoffSeries[];
  const bracketGames = (bracketGameRows ?? []) as PlayoffGame[];

  // Is the current user watching this league for draft stall alerts?
  // Only relevant while the draft is still live; the bell button is
  // hidden on completed drafts since stall alerts can't fire anyway.
  const { data: watchRow } = await supabase
    .from("draft_watches")
    .select("league_id")
    .eq("user_id", user.id)
    .eq("league_id", leagueId)
    .maybeSingle();
  const watchingDraft = Boolean(watchRow);
  const canWatchDraft =
    league.draft_status === "pending" ||
    league.draft_status === "in_progress";

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
        isOwner={isAppOwner(user.email)}
      />
      <DailyTicker />
      <main className="mx-auto max-w-4xl px-3 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
            {league.name}
          </h1>
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-ice-300 sm:text-sm">
            <span>Season {league.season}</span>
            <span aria-hidden="true">&middot;</span>
            <span className="inline-flex items-center gap-1.5">
              Join code{" "}
              <span className="rounded bg-puck-card px-1.5 py-0.5 font-mono text-ice-100">
                {league.join_code}
              </span>
              <CopyJoinCodeButton code={league.join_code} />
            </span>
            <span aria-hidden="true">&middot;</span>
            <span>Draft: {league.draft_status.replace("_", " ")}</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {league.draft_status !== "complete" && (
              <Link href={`/leagues/${league.id}/draft`}>
                <Button size="sm" variant="secondary">
                  Draft room
                </Button>
              </Link>
            )}
            {canWatchDraft && (
              <form action={toggleDraftWatchAction}>
                <input type="hidden" name="league_id" value={league.id} />
                <input
                  type="hidden"
                  name="action"
                  value={watchingDraft ? "unwatch" : "watch"}
                />
                <Button
                  size="sm"
                  variant={watchingDraft ? "primary" : "secondary"}
                  type="submit"
                  title={
                    watchingDraft
                      ? "Stop getting push alerts when the draft stalls"
                      : "Get a push notification when a team has been on the clock for 15+ min"
                  }
                >
                  {watchingDraft ? "🔔 Watching" : "🔕 Watch draft"}
                </Button>
              </form>
            )}
          </div>
        </div>

        <TonightsGames
          games={bracketGames}
          series={bracketSeries}
          bracketHref={`/leagues/${league.id}/bracket`}
        />

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
                <summary className="flex cursor-pointer list-none items-center justify-between gap-1.5 px-2.5 py-2 text-[11px] hover:bg-puck-border/40 [&::-webkit-details-marker]:hidden sm:gap-2 sm:px-3 sm:text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                    <span className="inline-block w-3 text-right text-ice-400 transition-transform group-open:rotate-90">
                      ▶
                    </span>
                    <span className="text-ice-400">{i + 1}.</span>
                    {movedUp && (
                      <span
                        title={rankTitle}
                        aria-label="Moved up overnight"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-green-500/20 text-[8px] font-bold text-green-300"
                      >
                        ▲
                      </span>
                    )}
                    {movedDown && (
                      <span
                        title={rankTitle}
                        aria-label="Moved down overnight"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-red-500/20 text-[8px] font-bold text-red-300"
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
                        className="flex-shrink-0 text-xs"
                      >
                        🔥
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-base font-bold text-ice-50 sm:text-lg">
                    {row.total}
                    <span className="ml-0.5 text-[9px] font-normal uppercase text-ice-400 sm:ml-1 sm:text-xs">
                      pts
                    </span>
                  </span>
                </summary>
                <div className="border-t border-puck-border px-2.5 py-2 text-[11px] sm:px-3 sm:text-sm">
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

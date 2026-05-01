import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";

// Force dynamic rendering so Next.js never serves a cached version
// of this page that's missing the just-deployed watch toggle (or
// any other header additions). Auth + Supabase queries make this
// effectively dynamic anyway, but being explicit guarantees it.
export const dynamic = "force-dynamic";
import { isAppOwner } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CopyJoinCodeButton } from "@/components/copy-join-code-button";
import { renameTeamAction } from "@/app/leagues/[leagueId]/team-actions";
import { TEAM_RENAME_MAX_LEN } from "@/app/leagues/[leagueId]/team-constants";
import { DailyTicker } from "@/components/daily-ticker";
import { TonightsGames } from "@/components/tonights-games";
import { scoreTeam } from "@/lib/scoring";
import { effectiveGameDay } from "@/lib/playoff-helpers";
import {
  eliminatedAbbrevsFromSeries,
  gamesScheduledTonight,
} from "@/lib/eliminated";
import { getOvernightDeltas } from "@/lib/snapshot-standings";
import type { OvernightDelta } from "@/lib/snapshot-standings";
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
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ rename_success?: string; rename_error?: string }>;
}) {
  const { leagueId } = await params;
  const { rename_success: renameSuccess, rename_error: renameError } =
    await searchParams;
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
    .eq("league_id", leagueId);

  // Team name per team id — used to label the owner column on the
  // MVP / Value Pick leaderboards so they match the standings rows.
  const teamOwnerDisplay = new Map<string, string>();
  for (const t of ((teams ?? []) as Team[])) {
    teamOwnerDisplay.set(t.id, t.name);
  }

  const isCommissioner = league.commissioner_id === user.id;
  const ownerFlag = isAppOwner(user.email);

  // Only query unresolved stat conflicts for the app owner
  let alertCount = 0;
  if (ownerFlag) {
    const svc = createServiceClient();
    const { count } = await svc
      .from("stat_conflicts")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false);
    alertCount = count ?? 0;
  }

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
  const { data: nhlTeamRows } = await supabase
    .from("nhl_teams")
    .select("abbrev, logo_url, eliminated");
  const bracketSeries = (bracketSeriesRows ?? []) as PlayoffSeries[];
  const bracketGames = (bracketGameRows ?? []) as PlayoffGame[];
  // Abbreviation → logo URL lookup for game components
  const teamLogos: Record<string, string> = {};
  const eliminatedAbbrevs = new Set<string>();
  for (const t of (nhlTeamRows ?? []) as {
    abbrev: string;
    logo_url: string | null;
    eliminated: boolean | null;
  }[]) {
    if (t.logo_url) teamLogos[t.abbrev] = t.logo_url;
    if (t.eliminated) eliminatedAbbrevs.add(t.abbrev);
  }
  // Also derive elimination from bracket state so a team disappears
  // the moment its series is clinched, not on the next cron run.
  for (const a of eliminatedAbbrevsFromSeries(bracketSeries)) {
    eliminatedAbbrevs.add(a);
  }

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

  // NHL teams with a game on tonight's effective date — used to show
  // "in play" counts on each standings row. Pulls from the SAME helper
  // the Tonight's Games card uses to pick its rows, so the badge can
  // never disagree with what the card displays (no more "FLA shown as
  // in play tonight while waiting on a second-round opponent").
  const { date: tonightDate } = effectiveGameDay();
  const tonightGames = gamesScheduledTonight(
    bracketGames,
    bracketSeries,
    tonightDate,
  );
  const inPlayAbbrevs = new Set<string>();
  for (const g of tonightGames) {
    if (g.away_abbrev) inPlayAbbrevs.add(g.away_abbrev);
    if (g.home_abbrev) inPlayAbbrevs.add(g.home_abbrev);
  }
  const inPlayByTeam = new Map<string, number>();
  for (const [teamId, roster] of rosterByTeam) {
    let count = 0;
    for (const r of roster) {
      if (r.nhl_abbrev && inPlayAbbrevs.has(r.nhl_abbrev)) count++;
    }
    if (count > 0) inPlayByTeam.set(teamId, count);
  }

  // Build current user's players list for tonight's games display
  const userTeam = ((teams ?? []) as Team[]).find(
    (t) => t.owner_id === user.id,
  );
  const myPlayers: {
    player_id: number;
    name: string;
    nhl_abbrev: string;
    owner: string;
  }[] = [];
  if (userTeam) {
    for (const row of (rosterRows as RosterEntry[] | null) ?? []) {
      if (row.nhl_abbrev && row.team_id === userTeam.id) {
        myPlayers.push({
          player_id: row.player_id,
          name: row.full_name,
          nhl_abbrev: row.nhl_abbrev,
          owner: userTeam.name,
        });
      }
    }
  }

  // Fetch per-game stats for user's players (for tonight's games)
  const myPlayerIds = myPlayers.map((p) => p.player_id);
  let playerGameStats: {
    game_id: number;
    player_id: number;
    goals: number;
    assists: number;
    ot_goals: number;
  }[] = [];
  if (myPlayerIds.length > 0) {
    const svc = createServiceClient();
    const { data: gameStatsData } = await svc
      .from("manual_game_stats")
      .select("game_id, player_id, goals, assists, ot_goals")
      .in("player_id", myPlayerIds);
    playerGameStats = (gameStatsData ?? []) as typeof playerGameStats;
  }

  // Any game with ot_goals > 0 across all players — used to label
  // Final OT on tonight's games. Separate from playerGameStats since
  // that's restricted to the current user's drafted players.
  const otGameIds = new Set<number>();
  {
    const svc = createServiceClient();
    const { data: otRows } = await svc
      .from("manual_game_stats")
      .select("game_id")
      .gt("ot_goals", 0);
    for (const r of (otRows ?? []) as { game_id: number }[]) {
      otGameIds.add(r.game_id);
    }
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

  // MVP: top scorers across the whole league. Value Pick: players whose
  // points × draft pick number is highest — rewards late-round picks
  // who produced. Both filter out zero-point players so a just-drafted
  // league doesn't show a meaningless list.
  const allDraftedPlayers = (rosterRows as RosterEntry[] | null) ?? [];
  type RankedPlayer = {
    player_id: number;
    full_name: string;
    fantasy_points: number;
    pick_number: number;
    owner: string;
  };
  const toRankedRow = (p: RosterEntry): RankedPlayer => ({
    player_id: p.player_id,
    full_name: p.full_name,
    fantasy_points: p.fantasy_points,
    pick_number: p.pick_number,
    owner: teamOwnerDisplay.get(p.team_id) ?? "?",
  });
  const mvpTop5 = allDraftedPlayers
    .filter((p) => p.fantasy_points > 0)
    .sort((a, b) => {
      if (b.fantasy_points !== a.fantasy_points)
        return b.fantasy_points - a.fantasy_points;
      if (b.goals !== a.goals) return b.goals - a.goals;
      return b.games_played - a.games_played;
    })
    .slice(0, 5)
    .map(toRankedRow);
  const valuePickTop5 = allDraftedPlayers
    .filter((p) => p.fantasy_points > 0)
    .sort((a, b) => {
      const av = a.fantasy_points * a.pick_number;
      const bv = b.fantasy_points * b.pick_number;
      if (bv !== av) return bv - av;
      return b.pick_number - a.pick_number;
    })
    .slice(0, 5)
    .map(toRankedRow);

  // Biggest busts: draftees picked in the top half of the draft who
  // produced the fewest points. Filtering to the top half keeps this
  // meaningful — a late-round pick scoring zero isn't a bust, it's
  // just a late-round pick. Ties break to the earliest pick (the
  // bigger the draft slot wasted, the worse the bust).
  const maxPickNumber = allDraftedPlayers.reduce(
    (m, p) => Math.max(m, p.pick_number),
    0,
  );
  const bustCutoff = Math.ceil(maxPickNumber / 2);
  const bustsTop5 =
    maxPickNumber === 0
      ? []
      : allDraftedPlayers
          .filter((p) => p.pick_number > 0 && p.pick_number <= bustCutoff)
          .sort((a, b) => {
            if (a.fantasy_points !== b.fantasy_points)
              return a.fantasy_points - b.fantasy_points;
            return a.pick_number - b.pick_number;
          })
          .slice(0, 5)
          .map(toRankedRow);

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
        isOwner={ownerFlag}
        alertCount={alertCount}
      />
      <DailyTicker leagueId={leagueId} />
      <main className="mx-auto max-w-4xl px-3 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
            {league.name}
          </h1>
          {league.draft_status !== "complete" && (
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
          )}
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
          teamLogos={teamLogos}
          leaguePlayers={myPlayers}
          playerGameStats={playerGameStats}
          otGameIds={otGameIds}
        />

        <div className="mt-6" />

        <HotTeams
          deltas={deltas}
          standings={standings}
          leagueAvgDelta={leagueAvgDelta}
        />

        <h2 className="mb-2 text-base font-semibold text-ice-100 sm:text-lg">
          Standings
        </h2>

        {renameSuccess && (
          <div className="mb-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-200 sm:text-sm">
            {renameSuccess}
          </div>
        )}
        {renameError && (
          <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200 sm:text-sm">
            {renameError}
          </div>
        )}

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
              const inPlayCount = inPlayByTeam.get(row.team.id) ?? 0;
              const teamRoster =
                rosterByTeam.get(row.team.id) ?? [];
              const aliveCount = teamRoster.reduce(
                (n, p) =>
                  n + (p.nhl_abbrev && eliminatedAbbrevs.has(p.nhl_abbrev) ? 0 : 1),
                0,
              );
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
                    <span
                      title={`${aliveCount} of ${teamRoster.length} players still on a non-eliminated team`}
                      className={
                        "flex-shrink-0 font-mono text-[10px] sm:text-xs " +
                        (aliveCount === teamRoster.length
                          ? "text-ice-500"
                          : aliveCount === 0
                            ? "text-red-400"
                            : "text-amber-300")
                      }
                    >
                      ({aliveCount}/{teamRoster.length})
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
                  <span className="flex flex-shrink-0 items-baseline gap-1.5 sm:gap-2">
                    {inPlayCount > 0 && (
                      <span
                        title={`${inPlayCount} ${inPlayCount === 1 ? "player" : "players"} on a team playing tonight`}
                        className="whitespace-nowrap rounded-full border border-ice-500/40 bg-ice-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ice-200 sm:px-2 sm:text-[10px]"
                      >
                        {inPlayCount} in play
                      </span>
                    )}
                    <span className="text-base font-bold text-ice-50 sm:text-lg">
                      {row.total}
                      <span className="ml-0.5 text-[9px] font-normal uppercase text-ice-400 sm:ml-1 sm:text-xs">
                        pts
                      </span>
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
                      inPlayAbbrevs={inPlayAbbrevs}
                      eliminatedAbbrevs={eliminatedAbbrevs}
                    />
                  )}
                  {(row.team.owner_id === user.id || isCommissioner) && (
                    <form
                      action={renameTeamAction}
                      className="mt-3 flex flex-wrap items-center gap-2 border-t border-puck-border pt-3"
                    >
                      <input type="hidden" name="league_id" value={leagueId} />
                      <input type="hidden" name="team_id" value={row.team.id} />
                      <input
                        type="hidden"
                        name="return_url"
                        value={`/leagues/${leagueId}`}
                      />
                      <label
                        htmlFor={`rename-${row.team.id}`}
                        className="text-ice-400"
                      >
                        Rename team:
                      </label>
                      <Input
                        id={`rename-${row.team.id}`}
                        name="team_name"
                        defaultValue={row.team.name}
                        maxLength={TEAM_RENAME_MAX_LEN}
                        required
                        className="w-56"
                      />
                      <Button type="submit" size="sm">
                        Save
                      </Button>
                    </form>
                  )}
                </div>
              </details>
              );
            })}
          </div>
        )}

        <PlayerRankings
          mvp={mvpTop5}
          valuePick={valuePickTop5}
          busts={bustsTop5}
        />

      </main>
    </>
  );
}

/**
 * Compact card showing which teams scored the most points overnight.
 * Uses the already-fetched overnight deltas — no extra queries.
 */
interface RankedPlayerRow {
  player_id: number;
  full_name: string;
  fantasy_points: number;
  pick_number: number;
  owner: string;
}

/**
 * Three side-by-side leaderboards under the standings:
 *   - MVP: highest playoff fantasy points in the league
 *   - Value Pick: highest (fantasy_points × pick_number), so a player
 *     drafted at pick 96 who scored 10 pts beats a player drafted at
 *     pick 5 who scored 12 pts — rewarding late-round production.
 *   - Biggest Busts: top-half draft picks with the fewest points —
 *     the inverse of Value Pick, calling out wasted early picks.
 */
function PlayerRankings({
  mvp,
  valuePick,
  busts,
}: {
  mvp: RankedPlayerRow[];
  valuePick: RankedPlayerRow[];
  busts: RankedPlayerRow[];
}) {
  if (mvp.length === 0 && valuePick.length === 0 && busts.length === 0)
    return null;
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <RankingTable
        title="MVP"
        rightLabel="Pts"
        rows={mvp.map((r) => ({
          name: r.full_name,
          owner: r.owner,
          right: `${r.fantasy_points}`,
        }))}
      />
      <RankingTable
        title="Value Pick"
        rightLabel="Pts · Pick"
        rows={valuePick.map((r) => ({
          name: r.full_name,
          owner: r.owner,
          right: `${r.fantasy_points} · #${r.pick_number}`,
        }))}
      />
      <RankingTable
        title="Biggest Busts"
        rightLabel="Pts · Pick"
        rows={busts.map((r) => ({
          name: r.full_name,
          owner: r.owner,
          right: `${r.fantasy_points} · #${r.pick_number}`,
        }))}
      />
    </div>
  );
}

function RankingTable({
  title,
  rightLabel,
  rows,
}: {
  title: string;
  rightLabel: string;
  rows: { name: string; owner: string; right: string }[];
}) {
  return (
    <section className="rounded-md border border-puck-border bg-puck-card">
      <header className="flex items-baseline justify-between gap-2 border-b border-puck-border px-3 py-2">
        <h3 className="text-sm font-semibold text-ice-100 sm:text-base">
          {title}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-ice-500">
          {rightLabel}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-ice-400">
          No scoring players yet.
        </p>
      ) : (
        <ol className="divide-y divide-puck-border/70">
          {rows.map((r, i) => (
            <li
              key={`${i}-${r.name}`}
              className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs sm:text-sm"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="w-4 flex-shrink-0 text-right text-ice-500">
                  {i + 1}.
                </span>
                <span className="min-w-0 truncate">
                  <span className="text-ice-100">{r.name}</span>
                  <span className="ml-1.5 text-ice-500">({r.owner})</span>
                </span>
              </span>
              <span className="flex-shrink-0 font-mono text-ice-200">
                {r.right}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function HotTeams({
  deltas,
  standings,
  leagueAvgDelta,
}: {
  deltas: Map<string, OvernightDelta> | null;
  standings: { team: Team; total: number }[];
  leagueAvgDelta: number;
}) {
  if (!deltas) return null;

  const rows = standings
    .map((s) => {
      const d = deltas.get(s.team.id);
      return d && d.delta_points > 0
        ? { name: s.team.name, pts: d.delta_points }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.pts - a!.pts) as { name: string; pts: number }[];

  if (rows.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardContent className="px-3 py-2.5 sm:px-4 sm:py-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ice-400 sm:text-xs">
          Last 24 Hours
        </p>
        <div className="space-y-0.5">
          {rows.map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between text-[11px] sm:text-sm"
            >
              <span className="truncate text-ice-100">{r.name}</span>
              <span className="flex-shrink-0 font-medium text-green-400">
                +{r.pts} pts
              </span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-ice-500 sm:text-xs">
          League avg: +{leagueAvgDelta.toFixed(1)} pts
        </p>
      </CardContent>
    </Card>
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
  inPlayAbbrevs,
  eliminatedAbbrevs,
}: {
  players: RosterEntry[];
  footerPlayers: RosterEntry[];
  adjustment: number;
  inPlayAbbrevs: Set<string>;
  eliminatedAbbrevs: Set<string>;
}) {
  const isInPlay = (p: RosterEntry) =>
    Boolean(p.nhl_abbrev && inPlayAbbrevs.has(p.nhl_abbrev));
  const isEliminated = (p: RosterEntry) =>
    Boolean(p.nhl_abbrev && eliminatedAbbrevs.has(p.nhl_abbrev));
  return (
    <div className="space-y-1">
      {players.map((p) => (
        <PlayerRow
          key={p.player_id}
          p={p}
          inPlay={isInPlay(p)}
          eliminated={isEliminated(p)}
        />
      ))}
      {footerPlayers.length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-puck-border" />
          <p className="mb-1 text-[10px] uppercase tracking-wider text-ice-500">
            Bench &middot; not counted
          </p>
          {footerPlayers.map((p) => (
            <PlayerRow
              key={p.player_id}
              p={p}
              muted
              inPlay={isInPlay(p)}
              eliminated={isEliminated(p)}
            />
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
  inPlay = false,
  eliminated = false,
}: {
  p: RosterEntry;
  muted?: boolean;
  inPlay?: boolean;
  eliminated?: boolean;
}) {
  const titleParts = [
    inPlay ? "Playing tonight" : null,
    eliminated ? "Team eliminated" : null,
  ].filter(Boolean);
  return (
    <Link
      href={`/players/${p.player_id}`}
      className={
        "flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-puck-border/40 " +
        (inPlay
          ? "border-l-2 border-ice-400 bg-ice-500/10 pl-1.5 "
          : "") +
        (eliminated ? "opacity-60" : "")
      }
      title={titleParts.length > 0 ? titleParts.join(" · ") : undefined}
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
        {p.nhl_logo && (
          <img src={p.nhl_logo} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
        )}
        <span
          className={
            "truncate " +
            (muted ? "text-ice-400 " : "text-ice-100 ") +
            (eliminated ? "line-through decoration-red-400/70" : "")
          }
        >
          {p.full_name}
        </span>
        <span className="text-[10px] text-ice-500">
          {p.nhl_abbrev ?? "—"}
        </span>
        {inPlay && (
          <span
            aria-label="Playing tonight"
            className="flex-shrink-0 text-[10px] leading-none text-ice-300"
          >
            ●
          </span>
        )}
      </span>
      <span
        className={`flex flex-shrink-0 items-baseline gap-2 font-semibold ${muted ? "text-ice-400" : "text-ice-50"}`}
      >
        <span>{p.fantasy_points}</span>
        <span
          title={`Drafted at pick #${p.pick_number}`}
          className="w-10 text-right font-mono text-[10px] font-normal text-ice-500"
        >
          #{p.pick_number}
        </span>
      </span>
    </Link>
  );
}

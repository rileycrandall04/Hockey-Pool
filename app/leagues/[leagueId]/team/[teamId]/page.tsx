import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { scoreTeam } from "@/lib/scoring";
import { renameTeamAction } from "@/app/leagues/[leagueId]/team-actions";
import { TEAM_RENAME_MAX_LEN } from "@/app/leagues/[leagueId]/team-constants";
import { eliminatedAbbrevsFromSeries } from "@/lib/eliminated";
import {
  fetchPointsForLatestGameDay,
  type LastGameStat,
} from "@/lib/last-game-stats";
import type { PlayoffSeries, RosterEntry, Team } from "@/lib/types";

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string; teamId: string }>;
  searchParams: Promise<{ rename_success?: string; rename_error?: string }>;
}) {
  const { leagueId, teamId } = await params;
  const { rename_success: renameSuccess, rename_error: renameError } =
    await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const league = await getLeagueForMember(supabase, leagueId, user.id);
  if (!league) notFound();

  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .single<Team>();
  if (!team) notFound();

  const isCommissioner = league.commissioner_id === user.id;
  const canRename = team.owner_id === user.id || isCommissioner;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: rosterRows } = await supabase
    .from("v_team_rosters")
    .select("*")
    .eq("team_id", teamId);

  const [{ data: nhlTeamRows }, { data: seriesRows }] = await Promise.all([
    supabase.from("nhl_teams").select("abbrev, eliminated"),
    supabase.from("playoff_series").select("*"),
  ]);
  const eliminatedAbbrevs = new Set<string>();
  for (const t of nhlTeamRows ?? []) {
    if (t.eliminated) eliminatedAbbrevs.add(t.abbrev);
  }
  for (const a of eliminatedAbbrevsFromSeries(
    (seriesRows ?? []) as PlayoffSeries[],
  )) {
    eliminatedAbbrevs.add(a);
  }

  const { data: adjustments } = await supabase
    .from("score_adjustments")
    .select("delta_points, reason")
    .eq("team_id", teamId);

  const adjTotal =
    (adjustments ?? []).reduce((s, a) => s + a.delta_points, 0) ?? 0;

  const scored = scoreTeam((rosterRows as RosterEntry[] | null) ?? [], {
    rosterSize: league.roster_size,
    scoringRosterSize: league.scoring_roster_size,
    requiredDefensemen: league.required_defensemen,
  });

  const rosterTotal = scored.totalPoints + adjTotal;
  const allRoster = (rosterRows as RosterEntry[] | null) ?? [];
  const aliveCount = allRoster.reduce(
    (n, p) => n + (p.nhl_abbrev && eliminatedAbbrevs.has(p.nhl_abbrev) ? 0 : 1),
    0,
  );

  // Per-player stats from the latest league-wide game day — fuels
  // both the green pill next to each row and the "from <date>" team
  // subtotal beside the headline.
  const svc = createServiceClient();
  const { date: latestGameDay, byPlayer: lastGameByPlayer } =
    await fetchPointsForLatestGameDay(
      svc,
      allRoster.map((p) => p.player_id),
    );
  const lastGameSubtotal = [...lastGameByPlayer.values()].reduce(
    (s, l) => s + l.fantasy_points,
    0,
  );

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
      />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Link
              href={`/leagues/${leagueId}`}
              className="text-sm text-ice-400 hover:underline"
            >
              ← {league.name}
            </Link>
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-3xl font-bold text-ice-50">{team.name}</h1>
              {allRoster.length > 0 && (
                <span
                  title={`${aliveCount} of ${allRoster.length} players still on a non-eliminated team`}
                  className={
                    "font-mono text-sm " +
                    (aliveCount === allRoster.length
                      ? "text-ice-500"
                      : aliveCount === 0
                        ? "text-red-400"
                        : "text-amber-300")
                  }
                >
                  ({aliveCount}/{allRoster.length})
                </span>
              )}
            </div>
            {canRename && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-ice-400 hover:text-ice-200">
                  Rename team
                </summary>
                <form
                  action={renameTeamAction}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="league_id" value={leagueId} />
                  <input type="hidden" name="team_id" value={teamId} />
                  <Input
                    name="team_name"
                    defaultValue={team.name}
                    maxLength={TEAM_RENAME_MAX_LEN}
                    required
                    className="w-64"
                    aria-label="Team name"
                  />
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </form>
                {renameSuccess && (
                  <p className="mt-2 text-xs text-green-300">{renameSuccess}</p>
                )}
                {renameError && (
                  <p className="mt-2 text-xs text-red-300">{renameError}</p>
                )}
              </details>
            )}
          </div>
          <div className="rounded-xl border border-puck-border bg-puck-card px-5 py-3 text-right">
            <div className="text-xs uppercase tracking-wide text-ice-400">
              Team points
            </div>
            <div className="text-3xl font-bold text-ice-50">{rosterTotal}</div>
            {adjTotal !== 0 && (
              <div className="text-xs text-ice-300">
                {adjTotal >= 0 ? "+" : ""}
                {adjTotal} from adjustments
              </div>
            )}
            {lastGameSubtotal > 0 && (
              <div className="mt-1 text-xs font-semibold text-green-300">
                +{lastGameSubtotal} from {latestGameDay ?? "last game"}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>
                Scoring lineup (top {league.scoring_roster_size}, {league.required_defensemen}D required)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <RosterTable
                rows={scored.scoring}
                highlight
                eliminatedAbbrevs={eliminatedAbbrevs}
                lastGameByPlayer={lastGameByPlayer}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bench (points don&rsquo;t count)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {scored.bench.length === 0 ? (
                <div className="px-5 py-6 text-sm text-ice-400">
                  No bench players yet.
                </div>
              ) : (
                <RosterTable
                  rows={scored.bench}
                  eliminatedAbbrevs={eliminatedAbbrevs}
                  lastGameByPlayer={lastGameByPlayer}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {(adjustments?.length ?? 0) > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Score adjustments</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {adjustments?.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between border-b border-puck-border pb-2 last:border-0"
                  >
                    <span className="text-ice-300">
                      {a.reason ?? "(no reason given)"}
                    </span>
                    <span
                      className={
                        a.delta_points >= 0 ? "text-green-400" : "text-red-400"
                      }
                    >
                      {a.delta_points >= 0 ? "+" : ""}
                      {a.delta_points}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

function RosterTable({
  rows,
  highlight = false,
  eliminatedAbbrevs,
  lastGameByPlayer,
}: {
  rows: RosterEntry[];
  highlight?: boolean;
  eliminatedAbbrevs: Set<string>;
  lastGameByPlayer: Map<number, LastGameStat>;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-puck-border text-left text-ice-400">
          <th className="px-4 py-2">Player</th>
          <th className="px-2 py-2">Pos</th>
          <th className="px-2 py-2">Team</th>
          <th className="px-2 py-2 text-right">GP</th>
          <th className="px-2 py-2 text-right">G</th>
          <th className="px-2 py-2 text-right">A</th>
          <th className="px-2 py-2 text-right">OT</th>
          <th className="px-2 py-2 text-right">Last</th>
          <th className="px-4 py-2 text-right">PTS</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const eliminated = !!r.nhl_abbrev && eliminatedAbbrevs.has(r.nhl_abbrev);
          const last = lastGameByPlayer.get(r.player_id);
          const lastPts = last?.fantasy_points ?? 0;
          const lastTitle = last
            ? `Last game ${last.game_date ?? ""} (${last.away_abbrev ?? "?"} @ ${last.home_abbrev ?? "?"}): ${last.goals}G ${last.assists}A ${last.ot_goals}OT`
            : "No game stats yet";
          return (
          <tr
            key={r.player_id}
            className={
              "border-b border-puck-border last:border-0 " +
              (eliminated ? "opacity-60" : "")
            }
            title={eliminated ? "Team eliminated" : undefined}
          >
            <td className="px-4 py-2 font-medium text-ice-100">
              <Link
                href={`/players/${r.player_id}`}
                className={
                  "hover:underline " +
                  (eliminated ? "line-through decoration-red-400/70" : "")
                }
              >
                {r.full_name}
              </Link>
            </td>
            <td className="px-2 py-2">
              <span
                className={
                  r.position === "D"
                    ? "rounded bg-ice-500/20 px-1.5 py-0.5 text-xs font-semibold text-ice-200"
                    : "rounded bg-puck-border px-1.5 py-0.5 text-xs text-ice-300"
                }
              >
                {r.position}
              </span>
            </td>
            <td className="px-2 py-2 text-ice-300">{r.nhl_abbrev ?? "—"}</td>
            <td className="px-2 py-2 text-right text-ice-300">
              {r.games_played}
            </td>
            <td className="px-2 py-2 text-right text-ice-300">{r.goals}</td>
            <td className="px-2 py-2 text-right text-ice-300">{r.assists}</td>
            <td className="px-2 py-2 text-right text-ice-300">{r.ot_goals}</td>
            <td
              className="px-2 py-2 text-right font-semibold"
              title={lastTitle}
            >
              {lastPts > 0 ? (
                <span className="text-green-300">+{lastPts}</span>
              ) : (
                <span className="text-ice-500">—</span>
              )}
            </td>
            <td
              className={`px-4 py-2 text-right font-semibold ${
                highlight ? "text-ice-50" : "text-ice-200"
              }`}
            >
              {r.fantasy_points}
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

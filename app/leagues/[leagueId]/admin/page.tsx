import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { teamOnTheClock, pickMeta } from "@/lib/draft";
import type { League, RosterEntry, Team } from "@/lib/types";

async function assertCommissioner(leagueId: string) {
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
  if (league.commissioner_id !== user.id) {
    redirect(`/leagues/${leagueId}`);
  }
  return { user, league };
}

async function dropPlayerAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const teamId = String(formData.get("team_id"));
  const playerId = Number(formData.get("player_id"));
  await assertCommissioner(leagueId);

  const svc = createServiceClient();
  await svc
    .from("draft_picks")
    .delete()
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("player_id", playerId);
  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
}

async function addPickAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const teamId = String(formData.get("team_id"));
  const playerIdRaw = String(formData.get("player_id"));
  const playerId = Number(playerIdRaw);
  if (!playerId) return;

  await assertCommissioner(leagueId);
  const svc = createServiceClient();

  const { data: existing } = await svc
    .from("draft_picks")
    .select("pick_number")
    .eq("league_id", leagueId)
    .order("pick_number", { ascending: false })
    .limit(1);
  const nextPick = (existing?.[0]?.pick_number ?? 0) + 1;

  await svc.from("draft_picks").insert({
    league_id: leagueId,
    team_id: teamId,
    player_id: playerId,
    round: 0, // commissioner-added pick, round 0 denotes "manual"
    pick_number: nextPick,
  });
  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
}

async function adjustScoreAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const teamId = String(formData.get("team_id"));
  const delta = Number(formData.get("delta_points"));
  const reason = String(formData.get("reason") ?? "");
  const { user } = await assertCommissioner(leagueId);

  if (!Number.isFinite(delta) || delta === 0) return;

  const svc = createServiceClient();
  await svc.from("score_adjustments").insert({
    league_id: leagueId,
    team_id: teamId || null,
    delta_points: delta,
    reason,
    created_by: user.id,
  });
  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
}

async function removeAdjustmentAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const adjId = String(formData.get("adj_id"));
  await assertCommissioner(leagueId);
  const svc = createServiceClient();
  await svc.from("score_adjustments").delete().eq("id", adjId);
  revalidatePath(`/leagues/${leagueId}/admin`);
}

/**
 * Undo the most recent N draft picks.
 *
 * Deletes the N highest-pick_number rows for the league, then
 * recomputes the on-the-clock team and draft status so the live
 * draft room lands on the correct pick after the rollback.
 *
 * Safe to call during an in-progress OR completed draft. Rolling back
 * from a completed state flips the league back to in_progress.
 *
 * Always redirects with either a success or error flash so the
 * commissioner gets visible feedback that the action ran.
 */
async function rollbackPicksAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const rawCount = String(formData.get("count") ?? "1");
  const count = Math.max(1, Math.min(50, parseInt(rawCount, 10) || 1));

  const { league } = await assertCommissioner(leagueId);
  const svc = createServiceClient();

  const { data: latest, error: latestError } = await svc
    .from("draft_picks")
    .select("id, pick_number")
    .eq("league_id", leagueId)
    .order("pick_number", { ascending: false })
    .limit(count);

  if (latestError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        `Lookup failed: ${latestError.message}`,
      )}`,
    );
  }

  if (!latest || latest.length === 0) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        "No picks to roll back.",
      )}`,
    );
  }

  const idsToDelete = latest.map((p) => p.id);
  const { error: deleteError } = await svc
    .from("draft_picks")
    .delete()
    .in("id", idsToDelete);

  if (deleteError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        `Delete failed: ${deleteError.message}`,
      )}`,
    );
  }

  // Recompute who's on the clock after the rollback.
  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .order("draft_position", { ascending: true, nullsFirst: false });

  const { count: newPickCount } = await svc
    .from("draft_picks")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);

  const teamList = (teams ?? []) as Team[];
  const totalPicks = teamList.length * league.roster_size;
  const newPickIndex = newPickCount ?? 0;

  const nextOnClock =
    teamList.length > 0 && newPickIndex < totalPicks
      ? teamOnTheClock(teamList, newPickIndex)
      : null;

  const { error: updateError } = await svc
    .from("leagues")
    .update({
      // Flip back to in_progress if the rollback uncompleted the draft.
      draft_status: nextOnClock ? "in_progress" : league.draft_status,
      draft_current_team: nextOnClock?.id ?? null,
      draft_round: nextOnClock
        ? pickMeta(newPickIndex, teamList.length).round
        : 1,
    })
    .eq("id", leagueId);

  if (updateError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        `League update failed: ${updateError.message}`,
      )}`,
    );
  }

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/draft`);

  redirect(
    `/leagues/${leagueId}/admin?reset_success=${encodeURIComponent(
      `Rolled back ${idsToDelete.length} pick${idsToDelete.length === 1 ? "" : "s"}.`,
    )}`,
  );
}

/**
 * Nuke the entire draft. Deletes every draft_picks row for the league
 * and resets the league back to draft_status='pending' so the
 * commissioner can re-start the draft (same teams, same roster size).
 *
 * Guarded by requiring the admin to type "RESET" into a confirmation
 * field so a rogue tap can't wipe a live draft.
 *
 * Every step is checked and surfaced via reset_success / reset_error
 * query params so silent failures are impossible.
 */
async function resetDraftAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "RESET") {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent("Type RESET to confirm.")}`,
    );
  }

  await assertCommissioner(leagueId);
  const svc = createServiceClient();

  // Count first so we can report what we're about to delete.
  const { count: pickCount, error: countError } = await svc
    .from("draft_picks")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);
  if (countError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        `Count failed: ${countError.message}`,
      )}`,
    );
  }

  const { error: deleteError } = await svc
    .from("draft_picks")
    .delete()
    .eq("league_id", leagueId);
  if (deleteError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        `Delete failed: ${deleteError.message}`,
      )}`,
    );
  }

  const { error: updateError } = await svc
    .from("leagues")
    .update({
      draft_status: "pending",
      draft_current_team: null,
      draft_round: 1,
      draft_started_at: null,
    })
    .eq("id", leagueId);
  if (updateError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        `League update failed: ${updateError.message}`,
      )}`,
    );
  }

  // Also clear team draft_position so the next start_draft re-randomizes
  // cleanly. Not strictly necessary (start_draft reassigns positions),
  // but it makes the "teams" panel honest while in pending state.
  const { error: teamsError } = await svc
    .from("teams")
    .update({ draft_position: null })
    .eq("league_id", leagueId);
  if (teamsError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        `Team reset failed: ${teamsError.message}`,
      )}`,
    );
  }

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/draft`);
  revalidatePath(`/dashboard`);

  redirect(
    `/leagues/${leagueId}/admin?reset_success=${encodeURIComponent(
      `Draft reset. Removed ${pickCount ?? 0} pick${pickCount === 1 ? "" : "s"} and returned all players to the pool.`,
    )}`,
  );
}

/**
 * Permanently delete the league.
 *
 * Cascades to every teams, draft_picks, and score_adjustments row for
 * the league via the existing FK ON DELETE CASCADE. nhl_teams,
 * players, and player_stats are global and untouched.
 *
 * Gated by typing "DELETE" into a confirmation field — same pattern
 * as the reset draft action, but a different keyword so a fat-finger
 * tap on Reset can't accidentally trigger Delete.
 *
 * After deletion redirects to /dashboard with a success flash. The
 * commissioner is the only person allowed to call this.
 */
async function deleteLeagueAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (confirm !== "DELETE") {
    redirect(
      `/leagues/${leagueId}/admin?delete_error=${encodeURIComponent("Type DELETE to confirm.")}`,
    );
  }

  const { league } = await assertCommissioner(leagueId);
  const svc = createServiceClient();

  const { error } = await svc.from("leagues").delete().eq("id", leagueId);
  if (error) {
    redirect(
      `/leagues/${leagueId}/admin?delete_error=${encodeURIComponent(error.message)}`,
    );
  }

  redirect(
    `/dashboard?league_deleted=${encodeURIComponent(`Deleted "${league.name}".`)}`,
  );
}

/**
 * Manually mark an NHL team as eliminated (or un-eliminate).
 * When eliminated, the team's undrafted players are flipped to inactive
 * so they drop out of the draft pool. Already-drafted players are
 * untouched — points they already earned still count.
 */
async function toggleTeamEliminationAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const teamIdRaw = String(formData.get("nhl_team_id"));
  const teamId = parseInt(teamIdRaw, 10);
  const eliminate = String(formData.get("action")) === "eliminate";

  await assertCommissioner(leagueId);
  if (!Number.isFinite(teamId)) return;

  const svc = createServiceClient();
  await svc
    .from("nhl_teams")
    .update({
      eliminated: eliminate,
      eliminated_at: eliminate ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", teamId);

  // Flip every undrafted player on that team. We can't tell from here
  // which players are drafted in OTHER leagues, so we deactivate them
  // globally — fine since the per-league draft state is independent of
  // active flag. (active=false just means "don't show in the draftable
  // pool for any new draft going forward".)
  await svc
    .from("players")
    .update({ active: !eliminate })
    .eq("nhl_team_id", teamId);

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}/draft`);
}

/**
 * Manually mark a single player as injured/healthy. Useful when the
 * automatic NHL injury feed misses someone, or for game-time
 * scratches that haven't shown up yet.
 */
async function toggleInjuryAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const playerIdRaw = String(formData.get("player_id"));
  const playerId = parseInt(playerIdRaw, 10);
  const status = String(formData.get("status") ?? "").trim() || null;

  await assertCommissioner(leagueId);
  if (!Number.isFinite(playerId)) return;

  const svc = createServiceClient();
  await svc
    .from("players")
    .update({
      injury_status: status,
      injury_description: status ? "(commissioner-flagged)" : null,
      injury_updated_at: new Date().toISOString(),
    })
    .eq("id", playerId);

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}/draft`);
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{
    reset_error?: string;
    reset_success?: string;
    delete_error?: string;
  }>;
}) {
  const { leagueId } = await params;
  const { reset_error, reset_success, delete_error } = await searchParams;
  const { league, user } = await assertCommissioner(leagueId);

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const svc = createServiceClient();
  const [
    { data: teams },
    { data: rosterRows },
    { data: adjustments },
    { count: pickCount },
    { data: nhlTeams },
    { count: totalPlayerCount },
    { count: playersWithSeasonStats },
    { count: injuredCount },
    { count: eliminatedTeamCount },
    { data: latestPlayerUpdate },
    { data: latestRecap },
  ] = await Promise.all([
    svc.from("teams").select("*").eq("league_id", leagueId),
    svc.from("v_team_rosters").select("*").eq("league_id", leagueId),
    svc
      .from("score_adjustments")
      .select("*")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false }),
    svc
      .from("draft_picks")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId),
    svc
      .from("nhl_teams")
      .select("id, abbrev, name, eliminated")
      .order("name"),
    svc.from("players").select("id", { count: "exact", head: true }),
    svc
      .from("players")
      .select("id", { count: "exact", head: true })
      .gt("season_points", 0),
    svc
      .from("players")
      .select("id", { count: "exact", head: true })
      .not("injury_status", "is", null),
    svc
      .from("nhl_teams")
      .select("id", { count: "exact", head: true })
      .eq("eliminated", true),
    svc
      .from("players")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1),
    svc
      .from("daily_recaps")
      .select("game_date")
      .order("game_date", { ascending: false })
      .limit(1),
  ]);

  const lastPlayerUpdateAt =
    (latestPlayerUpdate?.[0] as { updated_at?: string } | undefined)
      ?.updated_at ?? null;
  const lastRecapDate =
    (latestRecap?.[0] as { game_date?: string } | undefined)?.game_date ??
    null;

  const currentPickCount = pickCount ?? 0;
  const totalPicks = (teams?.length ?? 0) * league.roster_size;

  const rosterByTeam = new Map<string, RosterEntry[]>();
  for (const row of (rosterRows as RosterEntry[] | null) ?? []) {
    const arr = rosterByTeam.get(row.team_id) ?? [];
    arr.push(row);
    rosterByTeam.set(row.team_id, arr);
  }

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <Link
            href={`/leagues/${leagueId}`}
            className="text-sm text-ice-400 hover:underline"
          >
            ← {league.name}
          </Link>
          <h1 className="text-3xl font-bold text-ice-50">
            Commissioner tools
          </h1>
          <p className="text-sm text-ice-300">
            Edit rosters and log score adjustments. All actions are
            timestamped to {user.email}.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Data freshness</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-ice-400">
              All data below is pulled live from the NHL public API. If
              the &ldquo;with current-season stats&rdquo; count is much
              lower than the player count, the season-stats endpoint
              probably failed for some teams &mdash; tap{" "}
              <Link href="/debug/nhl" className="text-ice-200 underline">
                debug NHL endpoints
              </Link>{" "}
              to see exactly what came back.
            </p>
            <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Stat label="Players in pool" value={totalPlayerCount ?? 0} />
              <Stat
                label="With current-season stats"
                value={playersWithSeasonStats ?? 0}
              />
              <Stat label="Currently injured" value={injuredCount ?? 0} />
              <Stat
                label="Eliminated teams"
                value={eliminatedTeamCount ?? 0}
              />
              <Stat
                label="Last player refresh"
                value={
                  lastPlayerUpdateAt
                    ? relativeTime(lastPlayerUpdateAt)
                    : "never"
                }
              />
              <Stat
                label="Latest recap date"
                value={lastRecapDate ?? "none yet"}
              />
            </dl>
            <div className="flex flex-wrap gap-2">
              <form action="/api/admin/reseed" method="post">
                <Button type="submit">↻ Refresh NHL data now</Button>
              </form>
              <Link href="/debug/nhl">
                <Button variant="secondary">Debug NHL endpoints</Button>
              </Link>
            </div>
            <p className="mt-2 text-xs text-ice-500">
              Refresh takes ~30–60 seconds. It pulls every NHL team
              roster + this season&rsquo;s point totals + injuries.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Draft controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-sm text-ice-300">
              Status:{" "}
              <span className="font-medium text-ice-100">
                {league.draft_status.replace("_", " ")}
              </span>
              {" · "}
              {currentPickCount}/{totalPicks} picks made
            </div>

            {reset_success && (
              <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                ✅ {reset_success}
              </div>
            )}
            {reset_error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                ❌ {reset_error}
              </div>
            )}

            <div>
              <h3 className="mb-2 font-semibold text-ice-50">
                Undo recent picks
              </h3>
              <p className="mb-3 text-xs text-ice-400">
                Deletes the N most recent picks from the draft board and
                flips &ldquo;on the clock&rdquo; back to whoever should
                have that pick. Safe to use during a live draft — everyone
                watching the draft room will see the rollback in real time.
              </p>
              <form
                action={rollbackPicksAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="league_id" value={leagueId} />
                <div className="space-y-1">
                  <Label htmlFor="count"># of picks</Label>
                  <Input
                    id="count"
                    name="count"
                    type="number"
                    min={1}
                    max={50}
                    defaultValue={1}
                    className="max-w-[120px]"
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={currentPickCount === 0}
                >
                  Undo
                </Button>
              </form>
            </div>

            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4">
              <h3 className="mb-2 font-semibold text-red-300">
                Reset entire draft
              </h3>
              <p className="mb-3 text-xs text-ice-400">
                Wipes every draft pick in this league and puts the draft
                back to the waiting-to-start state. Team names and owners
                are untouched. There is no undo — use this only if the
                draft went off the rails.
              </p>
              <form
                action={resetDraftAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="league_id" value={leagueId} />
                <div className="space-y-1">
                  <Label htmlFor="confirm">
                    Type <span className="font-mono">RESET</span> to confirm
                  </Label>
                  <Input
                    id="confirm"
                    name="confirm"
                    placeholder="RESET"
                    className="max-w-[180px] font-mono"
                  />
                </div>
                <Button type="submit" variant="danger">
                  Reset draft
                </Button>
              </form>
            </div>

            <div
              id="delete-league"
              className="rounded-md border border-red-500/40 bg-red-500/10 p-4 scroll-mt-24"
            >
              <h3 className="mb-2 font-semibold text-red-300">
                Delete entire league
              </h3>
              <p className="mb-3 text-xs text-ice-400">
                Permanently removes <strong>{league.name}</strong>:
                every team, every roster, every adjustment. Other
                members will see the league disappear from their
                dashboards on their next page load. There is no undo.
              </p>
              {delete_error && (
                <div className="mb-3 rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {delete_error}
                </div>
              )}
              <form
                action={deleteLeagueAction}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="league_id" value={leagueId} />
                <div className="space-y-1">
                  <Label htmlFor="delete_confirm">
                    Type <span className="font-mono">DELETE</span> to confirm
                  </Label>
                  <Input
                    id="delete_confirm"
                    name="confirm"
                    placeholder="DELETE"
                    className="max-w-[180px] font-mono"
                  />
                </div>
                <Button type="submit" variant="danger">
                  Delete league
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Playoff teams</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ice-400">
              The nightly cron tries to detect eliminations from the NHL
              standings, but you can also override that here. Marking a
              team eliminated removes their undrafted players from the
              available pool. Players already drafted are untouched.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(nhlTeams ?? []).map(
                (t: {
                  id: number;
                  abbrev: string;
                  name: string;
                  eliminated: boolean;
                }) => (
                  <form
                    key={t.id}
                    action={toggleTeamEliminationAction}
                    className="flex items-center justify-between gap-2 rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm"
                  >
                    <input
                      type="hidden"
                      name="league_id"
                      value={leagueId}
                    />
                    <input
                      type="hidden"
                      name="nhl_team_id"
                      value={t.id}
                    />
                    <input
                      type="hidden"
                      name="action"
                      value={t.eliminated ? "uneliminate" : "eliminate"}
                    />
                    <div>
                      <span className="font-medium text-ice-100">
                        {t.abbrev}
                      </span>{" "}
                      <span className="text-ice-400">{t.name}</span>
                    </div>
                    <Button
                      size="sm"
                      type="submit"
                      variant={t.eliminated ? "secondary" : "danger"}
                    >
                      {t.eliminated ? "Reinstate" : "Eliminate"}
                    </Button>
                  </form>
                ),
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Injury override</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ice-400">
              Manually flag a player as injured (or clear an existing
              flag) when the NHL feed misses someone. Leave the status
              field blank to clear an injury.
            </p>
            <form
              action={toggleInjuryAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="league_id" value={leagueId} />
              <div className="space-y-1">
                <Label htmlFor="injury_player_id">Player ID</Label>
                <Input
                  id="injury_player_id"
                  name="player_id"
                  type="number"
                  placeholder="8478402"
                  className="max-w-[180px]"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="injury_status">Injury status</Label>
                <Input
                  id="injury_status"
                  name="status"
                  placeholder="Day-to-day (leave blank to clear)"
                  className="max-w-[280px]"
                />
              </div>
              <Button type="submit" variant="secondary">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rosters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {(teams ?? []).map((t: Team) => (
              <div key={t.id}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-ice-50">{t.name}</h3>
                  <span className="text-xs text-ice-400">
                    {(rosterByTeam.get(t.id) ?? []).length}/
                    {league.roster_size} players
                  </span>
                </div>

                <div className="rounded-md border border-puck-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-puck-border text-left text-ice-400">
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2">Pos</th>
                        <th className="px-3 py-2 text-right">PTS</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rosterByTeam.get(t.id) ?? []).map((r) => (
                        <tr
                          key={r.player_id}
                          className="border-b border-puck-border last:border-0"
                        >
                          <td className="px-3 py-2 text-ice-100">
                            {r.full_name}
                          </td>
                          <td className="px-3 py-2 text-ice-300">
                            {r.position}
                          </td>
                          <td className="px-3 py-2 text-right text-ice-200">
                            {r.fantasy_points}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <form action={dropPlayerAction}>
                              <input
                                type="hidden"
                                name="league_id"
                                value={leagueId}
                              />
                              <input
                                type="hidden"
                                name="team_id"
                                value={t.id}
                              />
                              <input
                                type="hidden"
                                name="player_id"
                                value={r.player_id}
                              />
                              <Button
                                size="sm"
                                variant="danger"
                                type="submit"
                              >
                                Drop
                              </Button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form
                  action={addPickAction}
                  className="mt-2 flex flex-wrap gap-2"
                >
                  <input type="hidden" name="league_id" value={leagueId} />
                  <input type="hidden" name="team_id" value={t.id} />
                  <Input
                    name="player_id"
                    placeholder="Player ID (from /players)"
                    className="max-w-[220px]"
                    required
                  />
                  <Button size="sm" variant="secondary" type="submit">
                    Add player
                  </Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Score adjustment</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={adjustScoreAction} className="space-y-3">
              <input type="hidden" name="league_id" value={leagueId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="team_id">Team</Label>
                  <Select id="team_id" name="team_id" required>
                    {(teams ?? []).map((t: Team) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="delta_points">Delta (+/- points)</Label>
                  <Input
                    id="delta_points"
                    name="delta_points"
                    type="number"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reason">Reason</Label>
                <Input
                  id="reason"
                  name="reason"
                  placeholder="Game 3 OT was missed by the stat feed"
                />
              </div>
              <Button type="submit">Apply adjustment</Button>
            </form>

            {(adjustments?.length ?? 0) > 0 && (
              <div className="mt-5 space-y-1 text-sm">
                <div className="mb-1 font-semibold text-ice-200">
                  Recent adjustments
                </div>
                {adjustments?.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between border-b border-puck-border py-1 last:border-0"
                  >
                    <span className="text-ice-300">
                      {a.delta_points >= 0 ? "+" : ""}
                      {a.delta_points} &middot; {a.reason || "(no reason)"}
                    </span>
                    <form action={removeAdjustmentAction}>
                      <input
                        type="hidden"
                        name="league_id"
                        value={leagueId}
                      />
                      <input type="hidden" name="adj_id" value={a.id} />
                      <Button size="sm" variant="ghost" type="submit">
                        Remove
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md border border-puck-border bg-puck-bg px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-ice-400">
        {label}
      </div>
      <div className="text-lg font-semibold text-ice-50">{value}</div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

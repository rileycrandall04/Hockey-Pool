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
 */
async function rollbackPicksAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const rawCount = String(formData.get("count") ?? "1");
  const count = Math.max(1, Math.min(50, parseInt(rawCount, 10) || 1));

  const { league } = await assertCommissioner(leagueId);
  const svc = createServiceClient();

  const { data: latest } = await svc
    .from("draft_picks")
    .select("id, pick_number")
    .eq("league_id", leagueId)
    .order("pick_number", { ascending: false })
    .limit(count);

  if (!latest || latest.length === 0) {
    // Nothing to roll back. Silently no-op — the admin page will just
    // re-render unchanged.
    revalidatePath(`/leagues/${leagueId}/admin`);
    return;
  }

  const idsToDelete = latest.map((p) => p.id);
  await svc.from("draft_picks").delete().in("id", idsToDelete);

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

  await svc
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

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/draft`);
}

/**
 * Nuke the entire draft. Deletes every draft_picks row for the league
 * and resets the league back to draft_status='pending' so the
 * commissioner can re-start the draft (same teams, same roster size).
 *
 * Guarded by requiring the admin to type "RESET" into a confirmation
 * field so a rogue tap can't wipe a live draft.
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

  await svc.from("draft_picks").delete().eq("league_id", leagueId);
  await svc
    .from("leagues")
    .update({
      draft_status: "pending",
      draft_current_team: null,
      draft_round: 1,
    })
    .eq("id", leagueId);

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/draft`);
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ reset_error?: string }>;
}) {
  const { leagueId } = await params;
  const { reset_error } = await searchParams;
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
  ]);

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

            {reset_error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {reset_error}
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


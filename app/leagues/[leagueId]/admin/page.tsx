import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { teamOnTheClock, pickMeta } from "@/lib/draft";
import { isAppOwner } from "@/lib/auth";
import { syncPlayoffBracket } from "@/lib/sync-bracket";
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

/**
 * Remove a team (and all of its draft picks + score adjustments)
 * from the league. Commissioner-only. The team's owner will see
 * the league disappear from their dashboard on their next load.
 *
 * Cascade: draft_picks and score_adjustments both have
 * `ON DELETE CASCADE` on team_id, so deleting the team row cleans
 * up dependent data automatically. The draft_watches row (if any)
 * is NOT deleted since it's keyed by user_id + league_id, not
 * team_id — that's harmless.
 */
async function removeTeamAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const teamId = String(formData.get("team_id"));
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "REMOVE") {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        'Type "REMOVE" to confirm team removal.',
      )}`,
    );
  }

  const { league } = await assertCommissioner(leagueId);

  // Don't let the commissioner remove their own team — that would
  // orphan the league (commissioner_id FK).
  const svc = createServiceClient();
  const { data: team } = await svc
    .from("teams")
    .select("owner_id, name")
    .eq("id", teamId)
    .eq("league_id", leagueId)
    .single();
  if (!team) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent("Team not found.")}`,
    );
  }
  if (team.owner_id === league.commissioner_id) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(
        "You can't remove your own team. Transfer commissioner first or delete the league.",
      )}`,
    );
  }

  const { error } = await svc
    .from("teams")
    .delete()
    .eq("id", teamId)
    .eq("league_id", leagueId);
  if (error) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  redirect(
    `/leagues/${leagueId}/admin?reset_success=${encodeURIComponent(
      `Removed team "${team.name}" from the league.`,
    )}`,
  );
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

/* ------------------------------------------------------------------ */
/*  Stat-conflict resolution (app-owner only)                          */
/* ------------------------------------------------------------------ */

interface StatsTriple {
  goals: number;
  assists: number;
  ot_goals: number;
}

async function applyPlayerStatsDelta(
  svc: ReturnType<typeof createServiceClient>,
  playerId: number,
  delta: StatsTriple,
): Promise<string | null> {
  if (delta.goals === 0 && delta.assists === 0 && delta.ot_goals === 0) {
    return null;
  }
  const { data: existing } = await svc
    .from("player_stats")
    .select("goals, assists, ot_goals, games_played")
    .eq("player_id", playerId)
    .maybeSingle();
  const prev = existing ?? { goals: 0, assists: 0, ot_goals: 0, games_played: 0 };
  const nextGoals = Math.max(0, prev.goals + delta.goals);
  const nextAssists = Math.max(0, prev.assists + delta.assists);
  const nextOt = Math.max(0, prev.ot_goals + delta.ot_goals);
  const clampedOt = Math.min(nextOt, nextGoals);
  const { error } = await svc
    .from("player_stats")
    .upsert(
      {
        player_id: playerId,
        goals: nextGoals,
        assists: nextAssists,
        ot_goals: clampedOt,
        games_played: prev.games_played,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "player_id" },
    );
  return error ? error.message : null;
}

async function acceptCronAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const conflictId = String(formData.get("conflict_id") ?? "");
  if (!conflictId || !leagueId) return;

  const { user } = await assertCommissioner(leagueId);
  if (!isAppOwner(user.email)) redirect(`/leagues/${leagueId}/admin`);

  const svc = createServiceClient();
  const { data: conflict } = await svc
    .from("stat_conflicts")
    .select("*")
    .eq("id", conflictId)
    .single();
  if (!conflict || conflict.resolved) {
    redirect(`/leagues/${leagueId}/admin`);
  }

  const delta: StatsTriple = {
    goals: conflict.cron_goals - conflict.manual_goals,
    assists: conflict.cron_assists - conflict.manual_assists,
    ot_goals: conflict.cron_ot_goals - conflict.manual_ot_goals,
  };

  const deltaError = await applyPlayerStatsDelta(svc, conflict.player_id, delta);
  if (deltaError) {
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(`Stat update: ${deltaError}`)}`,
    );
  }

  await svc
    .from("manual_game_stats")
    .update({
      goals: conflict.cron_goals,
      assists: conflict.cron_assists,
      ot_goals: conflict.cron_ot_goals,
      updated_at: new Date().toISOString(),
    })
    .eq("game_id", conflict.game_id)
    .eq("player_id", conflict.player_id);

  await svc
    .from("stat_conflicts")
    .update({
      resolved: true,
      resolution: "accepted_cron",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", conflictId);

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  redirect(`/leagues/${leagueId}/admin`);
}

async function keepManualAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const conflictId = String(formData.get("conflict_id") ?? "");
  if (!conflictId || !leagueId) return;

  const { user } = await assertCommissioner(leagueId);
  if (!isAppOwner(user.email)) redirect(`/leagues/${leagueId}/admin`);

  const svc = createServiceClient();
  await svc
    .from("stat_conflicts")
    .update({
      resolved: true,
      resolution: "kept_manual",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", conflictId);

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  redirect(`/leagues/${leagueId}/admin`);
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
      // Restart the stall-watch clock for whoever the rollback
      // landed on, and clear the notified marker so the new clock
      // can trigger a fresh alert.
      draft_on_clock_since: nextOnClock ? new Date().toISOString() : null,
      draft_stale_notified_for: null,
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
      draft_on_clock_since: null,
      draft_stale_notified_for: null,
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
 * Manually mark a single player as injured/healthy FOR THIS LEAGUE
 * ONLY. Writes to league_player_injuries (added in 0004), which the
 * v_team_rosters view LEFT JOINs and prefers over the global
 * players.injury_status column. Other leagues are unaffected.
 *
 * Setting an empty status DELETES the override row, which restores
 * the global NHL feed value for this league.
 */
async function addMemberAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const teamName = String(formData.get("team_name") ?? "").trim();

  if (!email || !teamName) {
    redirect(
      `/leagues/${leagueId}/admin?member_error=${encodeURIComponent(
        "Email and team name are both required.",
      )}`,
    );
  }

  await assertCommissioner(leagueId);
  const svc = createServiceClient();

  // Look up existing profile by email
  const { data: profile } = await svc
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let ownerId: string;

  if (profile) {
    ownerId = profile.id;
  } else {
    // User doesn't exist — invite them via Supabase Auth
    const { data: invite, error: inviteError } =
      await svc.auth.admin.inviteUserByEmail(email);
    if (inviteError || !invite.user) {
      redirect(
        `/leagues/${leagueId}/admin?member_error=${encodeURIComponent(
          inviteError?.message ?? "Failed to invite user.",
        )}`,
      );
    }
    ownerId = invite.user.id;

    // Upsert a profile row so the team FK is satisfied
    await svc.from("profiles").upsert(
      {
        id: ownerId,
        email,
        display_name: email.split("@")[0],
      },
      { onConflict: "id" },
    );
  }

  // Check for duplicate team (same league + owner)
  const { data: existing } = await svc
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existing) {
    redirect(
      `/leagues/${leagueId}/admin?member_error=${encodeURIComponent(
        "That user already has a team in this league.",
      )}`,
    );
  }

  const { error: insertError } = await svc.from("teams").insert({
    league_id: leagueId,
    owner_id: ownerId,
    name: teamName,
  });

  if (insertError) {
    redirect(
      `/leagues/${leagueId}/admin?member_error=${encodeURIComponent(
        insertError.message,
      )}`,
    );
  }

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/dashboard`);
  redirect(
    `/leagues/${leagueId}/admin?member_success=${encodeURIComponent(
      `Added "${teamName}" (${email}) to the league.`,
    )}`,
  );
}

async function syncBracketAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const { user } = await assertCommissioner(leagueId);
  if (!isAppOwner(user.email)) redirect(`/leagues/${leagueId}/admin`);

  try {
    const result = await syncPlayoffBracket();
    const msg = `Bracket synced: ${result.series_upserted} series, ${result.games_upserted} games.${result.errors.length > 0 ? ` ${result.errors.length} error(s).` : ""}`;
    revalidatePath(`/leagues/${leagueId}/bracket`);
    revalidatePath("/", "layout");
    redirect(
      `/leagues/${leagueId}/admin?reset_success=${encodeURIComponent(msg)}`,
    );
  } catch (err) {
    // redirect() throws a NEXT_REDIRECT error — rethrow it
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    // Also check the digest property used by Next.js
    if (err && typeof err === "object" && "digest" in err) throw err;
    const message = err instanceof Error ? err.message : "Unknown error";
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(`Bracket sync failed: ${message}`)}`,
    );
  }
}

/**
 * Delete unplayed (FUT/PRE/LIVE/null) playoff_games rows whose
 * series has already been clinched. Keeps every actually-played
 * game (FINAL/OFF) intact so scoreboards and stats are untouched.
 */
async function sweepFinishedSeriesAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const { user } = await assertCommissioner(leagueId);
  if (!isAppOwner(user.email)) redirect(`/leagues/${leagueId}/admin`);

  try {
    const svc = createServiceClient();
    const { data: series } = await svc
      .from("playoff_series")
      .select(
        "series_letter, top_seed_wins, bottom_seed_wins, needed_to_win, winning_team_abbrev",
      );
    const finishedLetters = (series ?? [])
      .filter((s) => {
        const needed = s.needed_to_win ?? 4;
        return (
          !!s.winning_team_abbrev ||
          s.top_seed_wins >= needed ||
          s.bottom_seed_wins >= needed
        );
      })
      .map((s) => s.series_letter);

    let deletedCount = 0;
    if (finishedLetters.length > 0) {
      const { count, error } = await svc
        .from("playoff_games")
        .delete({ count: "exact" })
        .in("series_letter", finishedLetters)
        .not("game_state", "in", "(FINAL,OFF)");
      if (error) throw error;
      deletedCount = count ?? 0;
    }

    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath(`/leagues/${leagueId}/bracket`);
    revalidatePath(`/leagues/${leagueId}/scoreboard`);
    revalidatePath("/", "layout");
    redirect(
      `/leagues/${leagueId}/admin?reset_success=${encodeURIComponent(
        `Swept ${deletedCount} unplayed game${deletedCount === 1 ? "" : "s"} from ${finishedLetters.length} finished series.`,
      )}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    if (err && typeof err === "object" && "digest" in err) throw err;
    const message = err instanceof Error ? err.message : "Unknown error";
    redirect(
      `/leagues/${leagueId}/admin?reset_error=${encodeURIComponent(`Sweep failed: ${message}`)}`,
    );
  }
}

async function toggleInjuryAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id"));
  const playerIdRaw = String(formData.get("player_id"));
  const playerId = parseInt(playerIdRaw, 10);
  const status = String(formData.get("status") ?? "").trim() || null;

  const { user } = await assertCommissioner(leagueId);
  if (!Number.isFinite(playerId)) return;

  const svc = createServiceClient();
  if (status === null) {
    // Clear: drop the override so the global value takes over.
    await svc
      .from("league_player_injuries")
      .delete()
      .eq("league_id", leagueId)
      .eq("player_id", playerId);
  } else {
    await svc.from("league_player_injuries").upsert(
      {
        league_id: leagueId,
        player_id: playerId,
        injury_status: status,
        injury_description: "(commissioner-flagged)",
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "league_id,player_id" },
    );
  }

  revalidatePath(`/leagues/${leagueId}/admin`);
  revalidatePath(`/leagues/${leagueId}/draft`);
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/teams`);
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
    member_error?: string;
    member_success?: string;
  }>;
}) {
  const { leagueId } = await params;
  const { reset_error, reset_success, delete_error, member_error, member_success } = await searchParams;
  const { league, user } = await assertCommissioner(leagueId);
  const canRefreshNhlData = isAppOwner(user.email);

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

  // Stat conflicts (app-owner only)
  let unresolvedConflicts: ConflictRow[] = [];
  let resolvedConflicts: ConflictRow[] = [];
  const conflictPlayerNames = new Map<number, string>();
  if (canRefreshNhlData) {
    const [{ data: uRows }, { data: rRows }] = await Promise.all([
      svc
        .from("stat_conflicts")
        .select("*")
        .eq("resolved", false)
        .order("created_at", { ascending: false }),
      svc
        .from("stat_conflicts")
        .select("*")
        .eq("resolved", true)
        .order("resolved_at", { ascending: false })
        .limit(20),
    ]);
    unresolvedConflicts = (uRows ?? []) as ConflictRow[];
    resolvedConflicts = (rRows ?? []) as ConflictRow[];

    const allPlayerIds = [
      ...new Set([
        ...unresolvedConflicts.map((c) => c.player_id),
        ...resolvedConflicts.map((c) => c.player_id),
      ]),
    ];
    if (allPlayerIds.length > 0) {
      const { data: players } = await svc
        .from("players")
        .select("id, full_name")
        .in("id", allPlayerIds);
      for (const p of players ?? []) {
        conflictPlayerNames.set(p.id, p.full_name);
      }
    }
  }

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={true}
        isOwner={isAppOwner(user.email)}
      />
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
          <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">Data freshness</span>
          </summary>
          <CardContent>
            <p className="mb-4 text-xs text-ice-400">
              All data below is pulled from the NHL public API by the
              nightly cron and on-demand by the app owner.{" "}
              {canRefreshNhlData && (
                <>
                  If the &ldquo;with current-season stats&rdquo; count is
                  much lower than the player count, the season-stats
                  endpoint probably failed for some teams &mdash; tap{" "}
                  <Link href="/debug/nhl" className="text-ice-200 underline">
                    debug NHL endpoints
                  </Link>{" "}
                  to see exactly what came back.
                </>
              )}
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
              {canRefreshNhlData && (
                <form action="/api/admin/reseed" method="post">
                  <Button type="submit">↻ Refresh NHL data now</Button>
                </form>
              )}
              {canRefreshNhlData && (
                <form action={syncBracketAction}>
                  <input type="hidden" name="league_id" value={leagueId} />
                  <Button type="submit" variant="secondary">
                    ↻ Sync bracket
                  </Button>
                </form>
              )}
              {canRefreshNhlData && (
                <form action="/api/admin/sync-injuries" method="post">
                  <Button type="submit" variant="secondary">
                    ↻ Sync injuries
                  </Button>
                </form>
              )}
              {canRefreshNhlData && (
                <form action={sweepFinishedSeriesAction}>
                  <input type="hidden" name="league_id" value={leagueId} />
                  <Button type="submit" variant="secondary">
                    🧹 Sweep finished series
                  </Button>
                </form>
              )}
              {canRefreshNhlData && (
                <Link href="/admin/reconcile-stats">
                  <Button variant="secondary">↻ Reconcile NHL stats</Button>
                </Link>
              )}
              {canRefreshNhlData && (
                <Link href="/admin/reconcile-totals">
                  <Button variant="secondary">↻ Reconcile player totals</Button>
                </Link>
              )}
              {canRefreshNhlData && (
                <Link href="/debug/nhl">
                  <Button variant="secondary">Debug NHL endpoints</Button>
                </Link>
              )}
            </div>
            {canRefreshNhlData ? (
              <p className="mt-2 text-xs text-ice-500">
                Refresh takes ~30–60 seconds. It pulls every NHL team
                roster + this season&rsquo;s point totals + injuries.
                The data is <strong>shared across every user</strong> —
                you only need to tap this once for the whole pool, and
                the nightly 6am cron handles it automatically. Other
                users don&rsquo;t need to refresh on their end.
              </p>
            ) : (
              <p className="mt-2 text-xs text-ice-500">
                The data above is shared across every user. The nightly
                6am cron refreshes it automatically; the app owner can
                also force a refresh at any time. You don&rsquo;t need
                to do anything to keep your view current.
              </p>
            )}
          </CardContent>
          </details>
        </Card>

        <Card>
          <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">Draft controls</span>
          </summary>
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
          </details>
        </Card>

        <Card>
          <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">Playoff teams</span>
          </summary>
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
          </details>
        </Card>

        <Card>
          <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">Injury override</span>
          </summary>
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
          </details>
        </Card>

        <Card>
          <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">Rosters</span>
          </summary>
          <CardContent className="space-y-6">
            {(teams ?? []).map((t: Team) => (
              <div key={t.id}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-ice-50">{t.name}</h3>
                  <span className="flex items-center gap-2 text-xs text-ice-400">
                    {(rosterByTeam.get(t.id) ?? []).length}/
                    {league.roster_size} players
                    {t.owner_id !== league.commissioner_id && (
                      <details className="relative inline-block">
                        <summary className="cursor-pointer rounded border border-red-500/40 px-1.5 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-500/10">
                          Remove team
                        </summary>
                        <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-puck-border bg-puck-card p-3 shadow-lg">
                          <form
                            action={removeTeamAction}
                            className="space-y-2"
                          >
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
                            <p className="text-[11px] text-ice-300">
                              This will delete{" "}
                              <strong>{t.name}</strong> and all their
                              draft picks from this league. There is
                              no undo.
                            </p>
                            <Input
                              name="confirm"
                              placeholder="Type REMOVE"
                              className="font-mono text-xs"
                            />
                            <Button
                              size="sm"
                              variant="danger"
                              type="submit"
                            >
                              Remove team
                            </Button>
                          </form>
                        </div>
                      </details>
                    )}
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
          </details>
        </Card>

        <Card>
          <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">Add member</span>
          </summary>
          <CardContent>
            <p className="mb-3 text-xs text-ice-400">
              Add someone to this league by email. If they already have an
              account they&rsquo;ll see the league on their next login. If
              not, they&rsquo;ll receive an invite email.
            </p>
            <p className="mb-3 text-sm text-ice-300">
              {(teams ?? []).length} team{(teams ?? []).length === 1 ? "" : "s"} in league
            </p>
            {member_success && (
              <div className="mb-3 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">
                {member_success}
              </div>
            )}
            {member_error && (
              <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {member_error}
              </div>
            )}
            <form action={addMemberAction} className="space-y-3">
              <input type="hidden" name="league_id" value={leagueId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="member_email">Email</Label>
                  <Input
                    id="member_email"
                    name="email"
                    type="email"
                    placeholder="player@example.com"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="member_team_name">Team name</Label>
                  <Input
                    id="member_team_name"
                    name="team_name"
                    placeholder="Team name"
                    required
                  />
                </div>
              </div>
              <Button type="submit">Add member</Button>
            </form>
          </CardContent>
          </details>
        </Card>

        <Card>
          <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">Score adjustment</span>
          </summary>
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
          </details>
        </Card>

        {canRefreshNhlData && (
        <Card>
          <details className="group" open={unresolvedConflicts.length > 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="inline-block w-3 text-ice-400 transition-transform group-open:rotate-90">▶</span>
            <span className="text-lg font-semibold text-ice-50">
              Stat conflicts
              {unresolvedConflicts.length > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                  {unresolvedConflicts.length}
                </span>
              )}
            </span>
          </summary>
          <CardContent>
            <p className="mb-3 text-xs text-ice-400">
              When you enter stats manually before the nightly cron runs,
              the cron skips those players. If the NHL data differs, a
              conflict appears here for review.
            </p>
            {unresolvedConflicts.length === 0 ? (
              <p className="text-sm text-ice-400">No unresolved conflicts.</p>
            ) : (
              <div className="space-y-3">
                {unresolvedConflicts.map((c) => (
                  <ConflictCard
                    key={c.id}
                    conflict={c}
                    leagueId={leagueId}
                    playerName={conflictPlayerNames.get(c.player_id) ?? `Player ${c.player_id}`}
                  />
                ))}
              </div>
            )}
            {resolvedConflicts.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-ice-300 hover:text-ice-100">
                  Resolved ({resolvedConflicts.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {resolvedConflicts.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm opacity-60"
                    >
                      <span className="text-ice-200">
                        {conflictPlayerNames.get(c.player_id) ?? `Player ${c.player_id}`}
                      </span>
                      <span className="text-xs text-ice-400">
                        {c.resolution === "accepted_cron"
                          ? "Accepted NHL data"
                          : "Kept manual data"}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
          </details>
        </Card>
        )}
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat conflict sub-components                                       */
/* ------------------------------------------------------------------ */

interface ConflictRow {
  id: string;
  game_id: number;
  player_id: number;
  manual_goals: number;
  manual_assists: number;
  manual_ot_goals: number;
  cron_goals: number;
  cron_assists: number;
  cron_ot_goals: number;
  resolution?: string;
  created_at: string;
}

function ConflictCard({
  conflict: c,
  leagueId,
  playerName,
}: {
  conflict: ConflictRow;
  leagueId: string;
  playerName: string;
}) {
  const goalsDiff = c.cron_goals - c.manual_goals;
  const assistsDiff = c.cron_assists - c.manual_assists;
  const otDiff = c.cron_ot_goals - c.manual_ot_goals;

  return (
    <div className="rounded-md border border-puck-border bg-puck-bg p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-ice-50">{playerName}</span>
        <span className="text-xs text-ice-400">Game {c.game_id}</span>
      </div>
      <div className="mb-3 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-sm">
        <div />
        <div className="text-center text-xs font-medium text-ice-400">G</div>
        <div className="text-center text-xs font-medium text-ice-400">A</div>
        <div className="text-center text-xs font-medium text-ice-400">OT</div>

        <div className="text-ice-300">Your data</div>
        <div className="text-center text-ice-100">{c.manual_goals}</div>
        <div className="text-center text-ice-100">{c.manual_assists}</div>
        <div className="text-center text-ice-100">{c.manual_ot_goals}</div>

        <div className="text-ice-300">NHL data</div>
        <div className="text-center text-ice-100">{c.cron_goals}</div>
        <div className="text-center text-ice-100">{c.cron_assists}</div>
        <div className="text-center text-ice-100">{c.cron_ot_goals}</div>

        <div className="text-ice-400">Diff</div>
        <DiffCell value={goalsDiff} />
        <DiffCell value={assistsDiff} />
        <DiffCell value={otDiff} />
      </div>

      <div className="flex gap-2">
        <form action={acceptCronAction}>
          <input type="hidden" name="league_id" value={leagueId} />
          <input type="hidden" name="conflict_id" value={c.id} />
          <Button type="submit" size="sm" variant="primary">
            Accept NHL Data
          </Button>
        </form>
        <form action={keepManualAction}>
          <input type="hidden" name="league_id" value={leagueId} />
          <input type="hidden" name="conflict_id" value={c.id} />
          <Button type="submit" size="sm" variant="secondary">
            Keep My Data
          </Button>
        </form>
      </div>
    </div>
  );
}

function DiffCell({ value }: { value: number }) {
  if (value === 0) {
    return <div className="text-center text-ice-500">0</div>;
  }
  return (
    <div
      className={`text-center font-medium ${value > 0 ? "text-green-300" : "text-red-300"}`}
    >
      {value > 0 ? "+" : ""}
      {value}
    </div>
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

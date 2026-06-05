import type { SupabaseClient } from "@supabase/supabase-js";
import type { League, Team } from "./types";
import { teamOnTheClock, pickMeta } from "./draft";

export interface DraftState {
  league: League;
  teams: Team[]; // sorted by draft_position ASC
  pickCount: number; // number of picks already made
  totalPicks: number; // teams * roster_size
  onClock: Team | null; // null when the draft is complete
}

/** Load a league's draft state (league row, ordered teams, pick count). */
export async function loadDraftState(
  svc: SupabaseClient,
  leagueId: string,
): Promise<DraftState> {
  const { data: league } = await svc
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();
  if (!league) throw new Error("League not found");

  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .order("draft_position", { ascending: true, nullsFirst: false });

  const { count } = await svc
    .from("draft_picks")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);

  const orderedTeams = (teams ?? []) as Team[];
  const pickCount = count ?? 0;
  const totalPicks = orderedTeams.length * (league as League).roster_size;
  const onClock =
    pickCount < totalPicks && orderedTeams.length > 0
      ? teamOnTheClock(orderedTeams, pickCount)
      : null;

  return {
    league: league as League,
    teams: orderedTeams,
    pickCount,
    totalPicks,
    onClock,
  };
}

export interface PickResult {
  ok: boolean;
  error?: string;
  complete?: boolean;
}

/**
 * Execute a single draft pick: validate the turn, insert the pick, and
 * advance the clock (or finish the draft). Must run with the service
 * client; the caller is responsible for authorizing the user.
 *
 * If `expectedTeamId` is provided, the pick only succeeds if that team is
 * actually on the clock (guards against double-submits / stale UIs).
 */
export async function executePick(
  svc: SupabaseClient,
  leagueId: string,
  countryId: number,
  expectedTeamId?: string,
): Promise<PickResult> {
  const state = await loadDraftState(svc, leagueId);

  if (state.league.draft_status !== "in_progress") {
    return { ok: false, error: "Draft is not in progress" };
  }
  if (!state.onClock) {
    return { ok: false, error: "Draft is already complete" };
  }
  if (expectedTeamId && state.onClock.id !== expectedTeamId) {
    return { ok: false, error: "It is not that team's turn" };
  }

  // Country must exist and not already be drafted in this league.
  const { data: country } = await svc
    .from("countries")
    .select("id")
    .eq("id", countryId)
    .maybeSingle();
  if (!country) return { ok: false, error: "Unknown country" };

  const { data: taken } = await svc
    .from("draft_picks")
    .select("id")
    .eq("league_id", leagueId)
    .eq("country_id", countryId)
    .maybeSingle();
  if (taken) return { ok: false, error: "Country already drafted" };

  const { round, pick_number } = pickMeta(state.pickCount, state.teams.length);

  const { error: insertErr } = await svc.from("draft_picks").insert({
    league_id: leagueId,
    team_id: state.onClock.id,
    country_id: countryId,
    round,
    pick_number,
  });
  if (insertErr) {
    // Unique-violation races (two picks at once) land here.
    return { ok: false, error: insertErr.message };
  }

  // Advance the clock.
  const nextPickCount = state.pickCount + 1;
  if (nextPickCount >= state.totalPicks) {
    await svc
      .from("leagues")
      .update({ draft_status: "complete", draft_current_team: null })
      .eq("id", leagueId);
    return { ok: true, complete: true };
  }

  const nextTeam = teamOnTheClock(state.teams, nextPickCount);
  const nextRound = Math.floor(nextPickCount / state.teams.length) + 1;
  await svc
    .from("leagues")
    .update({ draft_current_team: nextTeam.id, draft_round: nextRound })
    .eq("id", leagueId);

  return { ok: true };
}

/** Pick the best available country (lowest FIFA rank) for the team on the clock. */
export async function bestAvailableCountryId(
  svc: SupabaseClient,
  leagueId: string,
): Promise<number | null> {
  const { data: picks } = await svc
    .from("draft_picks")
    .select("country_id")
    .eq("league_id", leagueId);
  const taken = new Set((picks ?? []).map((p) => p.country_id as number));

  const { data: countries } = await svc
    .from("countries")
    .select("id, fifa_rank")
    .order("fifa_rank", { ascending: true, nullsFirst: false });

  for (const c of countries ?? []) {
    if (!taken.has(c.id as number)) return c.id as number;
  }
  return null;
}

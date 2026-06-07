import type { SupabaseClient } from "@supabase/supabase-js";
import type { League, Team } from "./types";
import { teamOnTheClock, pickMeta, randomizeDraftOrder, evenRosterSize } from "./draft";

/**
 * The draftable pool: the top `poolSize` countries by FIFA rank. The remaining
 * (lowest-ranked) teams go undrafted and are ignored by the app. Returns a set
 * of country ids.
 */
export async function draftPoolIds(
  svc: SupabaseClient,
  poolSize: number,
): Promise<Set<number>> {
  const { data } = await svc
    .from("countries")
    .select("id")
    .order("fifa_rank", { ascending: true, nullsFirst: false })
    .limit(poolSize);
  return new Set((data ?? []).map((c) => c.id as number));
}

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

  // ...and be inside this league's draft pool (the top teams by FIFA rank).
  const poolSize = state.teams.length * state.league.roster_size;
  const pool = await draftPoolIds(svc, poolSize);
  if (!pool.has(countryId)) {
    return { ok: false, error: "That team isn't in this league's draft pool" };
  }

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

export interface AutoDraftResult {
  ok: boolean;
  error?: string;
  picks?: number;
}

/**
 * Run an entire draft automatically: randomize the order, then snake-pick the
 * best available country (lowest FIFA rank) for each team until every roster
 * is full. Wipes any existing picks first. Marks the draft complete.
 */
export async function autoDraftEntire(
  svc: SupabaseClient,
  leagueId: string,
): Promise<AutoDraftResult> {
  const { data: league } = await svc
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();
  if (!league) return { ok: false, error: "League not found" };
  if ((league as League).draft_status === "complete") {
    return { ok: false, error: "Draft is already complete — reset it first" };
  }

  const { data: teams } = await svc.from("teams").select("*").eq("league_id", leagueId);
  const teamList = (teams ?? []) as Team[];
  if (teamList.length === 0) return { ok: false, error: "No teams in league" };

  // Even, equal roster size for this many owners; persist it.
  const rosterSize = evenRosterSize(teamList.length);
  if (rosterSize < 2) return { ok: false, error: "This draft supports up to 24 owners \u2014 the 48-team field can't be split evenly among more" };
  await svc.from("leagues").update({ roster_size: rosterSize }).eq("id", leagueId);

  // Randomize and persist the snake order.
  const ordered = randomizeDraftOrder(teamList).map((t, i) => ({ ...t, draft_position: i + 1 }));
  for (const t of ordered) {
    await svc.from("teams").update({ draft_position: t.draft_position }).eq("id", t.id);
  }

  // Draft pool: the top (owners * rosterSize) countries by FIFA rank.
  const totalPicks = teamList.length * rosterSize;
  const { data: countries } = await svc
    .from("countries")
    .select("id, fifa_rank")
    .order("fifa_rank", { ascending: true, nullsFirst: false })
    .limit(totalPicks);
  const available = (countries ?? []).map((c) => c.id as number);
  if (available.length < totalPicks) return { ok: false, error: "Not enough countries seeded" };

  // Fresh draft — clear any prior picks.
  await svc.from("draft_picks").delete().eq("league_id", leagueId);
  const rows: Array<Record<string, unknown>> = [];
  for (let pickIndex = 0; pickIndex < totalPicks; pickIndex++) {
    const team = teamOnTheClock(ordered, pickIndex);
    const countryId = available.shift();
    if (countryId == null) break;
    const { round, pick_number } = pickMeta(pickIndex, teamList.length);
    rows.push({ league_id: leagueId, team_id: team.id, country_id: countryId, round, pick_number });
  }

  const { error } = await svc.from("draft_picks").insert(rows);
  if (error) return { ok: false, error: error.message };

  await svc
    .from("leagues")
    .update({
      draft_status: "complete",
      draft_current_team: null,
      draft_started_at: new Date().toISOString(),
    })
    .eq("id", leagueId);

  return { ok: true, picks: rows.length };
}

/**
 * Pick the best available country (lowest FIFA rank) for the team on the clock,
 * restricted to the league's draft pool (the top `poolSize` teams by rank).
 */
export async function bestAvailableCountryId(
  svc: SupabaseClient,
  leagueId: string,
  poolSize: number,
): Promise<number | null> {
  const { data: picks } = await svc
    .from("draft_picks")
    .select("country_id")
    .eq("league_id", leagueId);
  const taken = new Set((picks ?? []).map((p) => p.country_id as number));

  const { data: countries } = await svc
    .from("countries")
    .select("id, fifa_rank")
    .order("fifa_rank", { ascending: true, nullsFirst: false })
    .limit(poolSize);

  for (const c of countries ?? []) {
    if (!taken.has(c.id as number)) return c.id as number;
  }
  return null;
}

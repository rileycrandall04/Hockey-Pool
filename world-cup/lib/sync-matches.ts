import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchWorldCupFixtures,
  fetchTopScorers,
  fetchFixtureEvents,
  fetchWorldCupTeams,
  fetchWorldCupStandings,
  groupLetter,
  mapStatus,
  mapStage,
  extractMatchday,
  type RawFixture,
  type RawEvent,
} from "./api-football";
import { fifaRankForName } from "./fifa-rankings";

/** Max fixtures to pull events for in one run (protects the API quota). */
const MAX_EVENT_FETCHES = 40;

export interface SyncSummary {
  teams_upserted: number;
  groups_set: number;
  ranks_set: number;
  fixtures_seen: number;
  matches_upserted: number;
  skipped_locked: number;
  unmatched_teams: string[];
  top_scorers: number;
  events_fetched: number;
  goals_ingested: number;
  conflicts_open: number;
  errors: string[];
}

/** Normalize a country name for fuzzy matching (lowercase, strip accents/punct). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// API-Football names -> our seed names (only where they differ).
const ALIASES: Record<string, string> = {
  unitedstates: "usa",
  usmnt: "usa",
  southkorea: "korearepublic",
  korearepublic: "korearepublic",
  ivorycoast: "ivorycoast",
  cotedivoire: "ivorycoast",
  iranislamicrepublic: "iran",
  capeverde: "capeverde",
  caboverde: "capeverde",
  czechrepublic: "czechia",
};

interface CountryRow {
  id: number;
  name: string;
  code: string;
  external_id: number | null;
}

class CountryResolver {
  private byExternal = new Map<number, CountryRow>();
  private byNorm = new Map<string, CountryRow>();

  constructor(rows: CountryRow[]) {
    for (const r of rows) {
      if (r.external_id != null) this.byExternal.set(r.external_id, r);
      this.byNorm.set(norm(r.name), r);
      this.byNorm.set(norm(r.code), r);
    }
  }

  resolve(team: { id: number; name: string }): CountryRow | null {
    const byId = this.byExternal.get(team.id);
    if (byId) return byId;
    const key = norm(team.name);
    const aliased = ALIASES[key] ?? key;
    return this.byNorm.get(aliased) ?? null;
  }
}

/** Build a match row from a raw fixture (returns null if stage can't be classified). */
function buildMatchRow(
  fx: RawFixture,
  homeId: number,
  awayId: number,
): Record<string, unknown> | null {
  const stage = mapStage(fx.league.round);
  if (!stage) return null;
  const wentToShootout =
    fx.score?.penalty?.home != null && fx.score?.penalty?.away != null;
  return {
    stage,
    matchday: stage === "group" ? extractMatchday(fx.league.round) : null,
    home_country_id: homeId,
    away_country_id: awayId,
    kickoff_utc: fx.fixture.date,
    status: mapStatus(fx.fixture.status.short),
    home_goals: fx.goals.home,
    away_goals: fx.goals.away,
    went_to_shootout: wentToShootout,
    home_pens: fx.score?.penalty?.home ?? null,
    away_pens: fx.score?.penalty?.away ?? null,
    external_id: fx.fixture.id,
    updated_at: new Date().toISOString(),
  };
}

interface StoredMatch {
  id: string;
  external_id: number;
  locked: boolean;
  home_goals: number | null;
  away_goals: number | null;
  went_to_shootout: boolean;
  home_pens: number | null;
  away_pens: number | null;
}

/**
 * For a locked (manually-edited) match, compare the stored result against
 * what the API now reports. If they disagree and the API has a final result,
 * record a conflict for review; if they agree, clear any stale conflict.
 * Never overwrites the manual values. Returns true if a conflict is open.
 */
async function reconcileLockedMatch(
  svc: SupabaseClient,
  stored: StoredMatch,
  apiRow: Record<string, unknown>,
): Promise<boolean> {
  const status = apiRow.status as string;
  const ah = apiRow.home_goals as number | null;
  const aa = apiRow.away_goals as number | null;
  if (status !== "final" || ah == null || aa == null) return false;

  const aShoot = Boolean(apiRow.went_to_shootout);
  const ahp = (apiRow.home_pens as number | null) ?? null;
  const aap = (apiRow.away_pens as number | null) ?? null;

  const differs =
    stored.home_goals !== ah ||
    stored.away_goals !== aa ||
    Boolean(stored.went_to_shootout) !== aShoot ||
    (aShoot && (stored.home_pens !== ahp || stored.away_pens !== aap));

  if (!differs) {
    await svc.from("match_conflicts").delete().eq("match_id", stored.id);
    return false;
  }

  await svc.from("match_conflicts").upsert(
    {
      match_id: stored.id,
      manual_home_goals: stored.home_goals,
      manual_away_goals: stored.away_goals,
      manual_went_to_shootout: stored.went_to_shootout,
      manual_home_pens: stored.home_pens,
      manual_away_pens: stored.away_pens,
      api_home_goals: ah,
      api_away_goals: aa,
      api_went_to_shootout: aShoot,
      api_home_pens: ahp,
      api_away_pens: aap,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "match_id" },
  );
  return true;
}

interface ParsedGoal {
  playerId: number | null;
  playerName: string | null;
  scoringTeamApiId: number; // team credited with the goal
  scorerTeamApiId: number; // team the scorer plays for
  minute: number | null;
  type: "regular" | "penalty" | "own_goal";
}

/** Turn a raw event into a goal, or null if it isn't a countable goal. */
function parseGoalEvent(
  e: RawEvent,
  homeApiId: number,
  awayApiId: number,
): ParsedGoal | null {
  if (e.type !== "Goal") return null;
  if (e.detail === "Missed Penalty") return null;
  if (e.comments && e.comments.toLowerCase().includes("penalty shootout")) return null;

  const type =
    e.detail === "Own Goal" ? "own_goal" : e.detail === "Penalty" ? "penalty" : "regular";
  const scorerTeamApiId = e.team.id;
  const scoringTeamApiId =
    type === "own_goal"
      ? scorerTeamApiId === homeApiId
        ? awayApiId
        : homeApiId
      : scorerTeamApiId;
  const minute =
    e.time?.elapsed != null ? e.time.elapsed + (e.time.extra ?? 0) : null;
  return {
    playerId: e.player?.id ?? null,
    playerName: e.player?.name ?? null,
    scoringTeamApiId,
    scorerTeamApiId,
    minute,
    type,
  };
}

/** Derive a 3-letter code from a country name when the API doesn't give one. */
function deriveCode(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (letters.slice(0, 3) || "XXX").padEnd(3, "X");
}

interface FullCountryRow {
  id: number;
  name: string;
  code: string;
  external_id: number | null;
  manual_override: boolean;
  group_letter: string | null;
  fifa_rank: number | null;
  flag_url: string | null;
}

/**
 * Sync the real team list + group letters (from API-Football's /teams and
 * /standings) and apply FIFA ranks (from our reference, since the API has
 * none). Countries flagged manual_override keep their hand-set name/group/
 * rank; we still backfill their external_id and flag. Each step is guarded.
 */
async function syncTeamsGroupsRanks(
  svc: SupabaseClient,
  summary: SyncSummary,
): Promise<void> {
  // Group letter per API team id (may be empty before kickoff).
  const groupByApiId = new Map<number, string>();
  try {
    const standings = await fetchWorldCupStandings();
    for (const r of standings) {
      const g = groupLetter(r.group);
      if (g) groupByApiId.set(r.team.id, g);
    }
  } catch (err) {
    summary.errors.push("standings: " + (err instanceof Error ? err.message : "failed"));
  }

  // The real team list -> upsert into countries.
  try {
    const { data: countryRows } = await svc
      .from("countries")
      .select("id, name, code, external_id, manual_override, group_letter, fifa_rank, flag_url");
    const rows = (countryRows ?? []) as FullCountryRow[];
    const resolver = new CountryResolver(
      rows.map((r) => ({ id: r.id, name: r.name, code: r.code, external_id: r.external_id })),
    );
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const usedCodes = new Set(rows.map((r) => r.code.toUpperCase()));

    const teams = await fetchWorldCupTeams();
    for (const t of teams) {
      const existing = resolver.resolve({ id: t.team.id, name: t.team.name });
      const grp = groupByApiId.get(t.team.id) ?? null;
      const rank = fifaRankForName(t.team.name);

      if (existing) {
        const row = rowById.get(existing.id)!;
        const update: Record<string, unknown> = {};
        if (row.external_id == null) update.external_id = t.team.id;
        if (t.team.logo && row.flag_url !== t.team.logo) update.flag_url = t.team.logo;
        if (!row.manual_override) {
          if (grp && grp !== row.group_letter) { update.group_letter = grp; summary.groups_set++; }
          if (rank != null && rank !== row.fifa_rank) { update.fifa_rank = rank; summary.ranks_set++; }
        }
        if (Object.keys(update).length > 0) {
          await svc.from("countries").update(update).eq("id", existing.id);
        }
        summary.teams_upserted++;
      } else {
        // A real team not in our seed — insert it.
        let code = (t.team.code || deriveCode(t.team.name)).toUpperCase();
        while (usedCodes.has(code)) code = code.slice(0, 2) + String((code.charCodeAt(2) + 1) % 90 + 33);
        usedCodes.add(code);
        const { error } = await svc.from("countries").insert({
          name: t.team.name,
          code,
          external_id: t.team.id,
          flag_url: t.team.logo ?? null,
          group_letter: grp,
          fifa_rank: rank,
        });
        if (error) summary.errors.push(`insert ${t.team.name}: ${error.message}`);
        else { summary.teams_upserted++; if (grp) summary.groups_set++; if (rank != null) summary.ranks_set++; }
      }
    }
  } catch (err) {
    summary.errors.push("teams: " + (err instanceof Error ? err.message : "failed"));
  }

  // Apply FIFA ranks to any remaining (non-override) countries by name, so
  // ranks are corrected even if /teams didn't return everyone.
  try {
    const { data: allC } = await svc
      .from("countries")
      .select("id, name, fifa_rank, manual_override");
    for (const c of allC ?? []) {
      if (c.manual_override) continue;
      const rank = fifaRankForName(c.name as string);
      if (rank != null && rank !== c.fifa_rank) {
        await svc.from("countries").update({ fifa_rank: rank }).eq("id", c.id);
        summary.ranks_set++;
      }
    }
  } catch (err) {
    summary.errors.push("ranks: " + (err instanceof Error ? err.message : "failed"));
  }
}

export interface SyncOptions {
  /** Narrow the fixtures pull to a [from, to] date window (YYYY-MM-DD). */
  window?: { from?: string; to?: string };
  /**
   * "light" skips the /teams and /standings calls (team list, group letters,
   * logos — these barely change once the tournament is set) so a frequent
   * live-polling cron stays cheap and fast. "full" (the default) does
   * everything and is what the nightly cron uses.
   */
  mode?: "full" | "light";
  /**
   * Also refresh goal events for in-progress (live) matches so live scorers
   * appear and update mid-match. Defaults on in light mode. Live matches are
   * re-pulled every run (never marked goals_synced) until they go final.
   */
  liveEvents?: boolean;
}

/**
 * Cheap (DB-only, no API calls) check for whether any match is currently
 * "active" and therefore worth polling the live feed for. True when a match
 * is already marked live, or its kickoff time falls inside the window
 * [now - postHours, now + preMinutes] and it hasn't gone final yet — i.e. a
 * game is about to start, is in progress, or could still be running.
 *
 * Lets the cron self-gate: start polling around kickoff, stop once every
 * game of the day has finished, without burning API calls in dead hours.
 */
export async function hasActiveMatchWindow(
  svc: SupabaseClient,
  opts?: { preMinutes?: number; postHours?: number },
): Promise<boolean> {
  const preMinutes = opts?.preMinutes ?? 10;
  const postHours = opts?.postHours ?? 3.5; // 90' + ET + pens + buffer
  const now = Date.now();

  // Any match already in progress?
  const { data: live } = await svc
    .from("matches")
    .select("id")
    .eq("status", "live")
    .limit(1);
  if (live && live.length > 0) return true;

  // Any not-yet-final match whose kickoff is near now (just upcoming, or
  // recent enough that it could still be playing)?
  const lower = new Date(now - postHours * 3_600_000).toISOString();
  const upper = new Date(now + preMinutes * 60_000).toISOString();
  const { data: near } = await svc
    .from("matches")
    .select("id")
    .neq("status", "final")
    .gte("kickoff_utc", lower)
    .lte("kickoff_utc", upper)
    .limit(1);
  return Boolean(near && near.length > 0);
}

/**
 * Pull World Cup fixtures + the top-scorers leaderboard from API-Football
 * and upsert them. Locked matches (commissioner-corrected) are never
 * overwritten. Idempotent — safe to run repeatedly.
 *
 * Accepts a plain date window for backward compatibility, or a full
 * {@link SyncOptions} object for light-mode / live-event polling.
 */
export async function syncMatches(
  svc: SupabaseClient,
  optsOrWindow?: SyncOptions | { from?: string; to?: string },
): Promise<SyncSummary> {
  // Back-compat: a bare {from,to} is treated as the fixtures window.
  const opts: SyncOptions =
    optsOrWindow && ("window" in optsOrWindow || "mode" in optsOrWindow || "liveEvents" in optsOrWindow)
      ? (optsOrWindow as SyncOptions)
      : { window: optsOrWindow as { from?: string; to?: string } | undefined };
  const mode = opts.mode ?? "full";
  const liveEvents = opts.liveEvents ?? mode === "light";
  const window = opts.window;
  const summary: SyncSummary = {
    teams_upserted: 0,
    groups_set: 0,
    ranks_set: 0,
    fixtures_seen: 0,
    matches_upserted: 0,
    skipped_locked: 0,
    unmatched_teams: [],
    top_scorers: 0,
    events_fetched: 0,
    goals_ingested: 0,
    conflicts_open: 0,
    errors: [],
  };

  // Pull the real team list, group assignments, and apply FIFA ranks first,
  // so fixtures match against accurate countries. Best-effort and per-step
  // guarded — a failure here never blocks the rest of the sync. Skipped in
  // light mode (these /teams + /standings calls rarely change intra-day).
  if (mode !== "light") {
    await syncTeamsGroupsRanks(svc, summary);
  }

  const { data: countryRows } = await svc
    .from("countries")
    .select("id, name, code, external_id");
  const resolver = new CountryResolver((countryRows ?? []) as CountryRow[]);

  // Existing matches keyed by external_id, so we can spot locked ones and
  // compare their stored (manual) values against what the API now reports.
  const { data: existing } = await svc
    .from("matches")
    .select("id, external_id, locked, home_goals, away_goals, went_to_shootout, home_pens, away_pens")
    .not("external_id", "is", null);
  const storedByExtId = new Map<number, StoredMatch>();
  for (const m of existing ?? []) storedByExtId.set(m.external_id as number, m as StoredMatch);

  // -------- Fixtures ----------------------------------------------------
  try {
    const fixtures = await fetchWorldCupFixtures(window);
    summary.fixtures_seen = fixtures.length;
    const unmatched = new Set<string>();

    for (const fx of fixtures) {
      const home = resolver.resolve(fx.teams.home);
      const away = resolver.resolve(fx.teams.away);
      if (!home || !away) {
        if (!home) unmatched.add(fx.teams.home.name);
        if (!away) unmatched.add(fx.teams.away.name);
        continue;
      }

      // Opportunistically backfill external_id so future syncs match exactly.
      if (home.external_id == null) {
        await svc.from("countries").update({ external_id: fx.teams.home.id }).eq("id", home.id);
        home.external_id = fx.teams.home.id;
      }
      if (away.external_id == null) {
        await svc.from("countries").update({ external_id: fx.teams.away.id }).eq("id", away.id);
        away.external_id = fx.teams.away.id;
      }

      const row = buildMatchRow(fx, home.id, away.id);
      if (!row) continue;

      const stored = storedByExtId.get(fx.fixture.id);
      if (stored?.locked) {
        // Don't overwrite a manual edit — but if the API now disagrees,
        // record the conflict so a commissioner can reconcile it.
        summary.skipped_locked++;
        if (await reconcileLockedMatch(svc, stored, row)) summary.conflicts_open++;
        continue;
      }

      const { error } = await svc
        .from("matches")
        .upsert(row, { onConflict: "external_id" });
      if (error) summary.errors.push(`fixture ${fx.fixture.id}: ${error.message}`);
      else summary.matches_upserted++;
    }

    summary.unmatched_teams = [...unmatched];
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : "fixtures sync failed");
  }

  // -------- Goal scorers (per-match events) -----------------------------
  // Only for final, non-locked matches we haven't pulled yet, capped so a
  // backfill can't blow the daily API quota. Manual goals are preserved.
  try {
    const { data: freshCountries } = await svc
      .from("countries")
      .select("id, external_id");
    const extIdToCountryId = new Map<number, number>();
    const countryIdToExtId = new Map<number, number>();
    for (const c of freshCountries ?? []) {
      if (c.external_id != null) {
        extIdToCountryId.set(c.external_id as number, c.id as number);
        countryIdToExtId.set(c.id as number, c.external_id as number);
      }
    }

    // Final matches we haven't pulled goals for yet (one-time, then locked in).
    const { data: pendingFinal } = await svc
      .from("matches")
      .select("id, external_id, home_country_id, away_country_id")
      .eq("status", "final")
      .eq("locked", false)
      .eq("goals_synced", false)
      .not("external_id", "is", null)
      .limit(MAX_EVENT_FETCHES);

    const toProcess: Array<{
      id: string;
      external_id: number;
      home_country_id: number;
      away_country_id: number;
      markSynced: boolean;
    }> = (pendingFinal ?? []).map((m) => ({
      id: m.id as string,
      external_id: m.external_id as number,
      home_country_id: m.home_country_id as number,
      away_country_id: m.away_country_id as number,
      markSynced: true,
    }));

    // Live matches: refresh their scorers every run so the scoreboard updates
    // mid-match. Never marked goals_synced — they keep refreshing until final.
    if (liveEvents) {
      const { data: liveMatches } = await svc
        .from("matches")
        .select("id, external_id, home_country_id, away_country_id")
        .eq("status", "live")
        .eq("locked", false)
        .not("external_id", "is", null)
        .limit(MAX_EVENT_FETCHES);
      for (const m of liveMatches ?? []) {
        toProcess.push({
          id: m.id as string,
          external_id: m.external_id as number,
          home_country_id: m.home_country_id as number,
          away_country_id: m.away_country_id as number,
          markSynced: false,
        });
      }
    }

    for (const match of toProcess) {
      const homeApiId = countryIdToExtId.get(match.home_country_id as number);
      const awayApiId = countryIdToExtId.get(match.away_country_id as number);
      if (homeApiId == null || awayApiId == null) continue;

      const events = await fetchFixtureEvents(match.external_id as number);
      summary.events_fetched++;

      // Replace this match's API-sourced goals (keep manual ones).
      await svc
        .from("match_goals")
        .delete()
        .eq("match_id", match.id as string)
        .eq("manual", false);

      for (const e of events) {
        const g = parseGoalEvent(e, homeApiId, awayApiId);
        if (!g) continue;

        // Upsert the scorer (by API player id) so we can attribute goals.
        let playerId: number | null = null;
        const scorerCountryId = extIdToCountryId.get(g.scorerTeamApiId) ?? null;
        if (g.playerId != null && g.playerName) {
          const { data: player } = await svc
            .from("players")
            .upsert(
              { name: g.playerName, country_id: scorerCountryId, external_id: g.playerId },
              { onConflict: "external_id" },
            )
            .select("id")
            .single();
          playerId = (player?.id as number) ?? null;
        }

        await svc.from("match_goals").insert({
          match_id: match.id as string,
          country_id: extIdToCountryId.get(g.scoringTeamApiId) ?? null,
          scorer_player_id: playerId,
          minute: g.minute,
          type: g.type,
          is_shootout: false,
          manual: false,
        });
        summary.goals_ingested++;
      }

      if (match.markSynced) {
        await svc.from("matches").update({ goals_synced: true }).eq("id", match.id);
      }
    }
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : "events sync failed");
  }

  // -------- Top scorers (Golden Boot) -----------------------------------
  try {
    const scorers = await fetchTopScorers();
    // Refresh the cache wholesale (it's tiny).
    await svc.from("top_scorers").delete().neq("player_external_id", -1);

    let rank = 0;
    for (const s of scorers) {
      rank++;
      const stat = s.statistics?.[0];
      if (!stat) continue;
      const country = resolver.resolve(stat.team);

      // Upsert the player so the Golden Boot owner can be resolved later.
      let playerId: number | null = null;
      if (country) {
        const { data: player } = await svc
          .from("players")
          .upsert(
            { name: s.player.name, country_id: country.id, external_id: s.player.id },
            { onConflict: "external_id" },
          )
          .select("id")
          .single();
        playerId = (player?.id as number) ?? null;
      }

      await svc.from("top_scorers").upsert(
        {
          player_external_id: s.player.id,
          player_id: playerId,
          player_name: s.player.name,
          country_external_id: stat.team.id,
          country_id: country?.id ?? null,
          goals: stat.goals.total ?? 0,
          assists: stat.goals.assists ?? 0,
          minutes: stat.games.minutes ?? 0,
          rank,
        },
        { onConflict: "player_external_id" },
      );
      summary.top_scorers++;
    }
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : "top-scorers sync failed");
  }

  return summary;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchWorldCupFixtures,
  fetchTopScorers,
  fetchFixtureEvents,
  mapStatus,
  mapStage,
  extractMatchday,
  type RawFixture,
  type RawEvent,
} from "./api-football";

/** Max fixtures to pull events for in one run (protects the API quota). */
const MAX_EVENT_FETCHES = 40;

export interface SyncSummary {
  fixtures_seen: number;
  matches_upserted: number;
  skipped_locked: number;
  unmatched_teams: string[];
  top_scorers: number;
  events_fetched: number;
  goals_ingested: number;
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

/**
 * Pull World Cup fixtures + the top-scorers leaderboard from API-Football
 * and upsert them. Locked matches (commissioner-corrected) are never
 * overwritten. Idempotent — safe to run repeatedly.
 */
export async function syncMatches(
  svc: SupabaseClient,
  window?: { from?: string; to?: string },
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    fixtures_seen: 0,
    matches_upserted: 0,
    skipped_locked: 0,
    unmatched_teams: [],
    top_scorers: 0,
    events_fetched: 0,
    goals_ingested: 0,
    errors: [],
  };

  const { data: countryRows } = await svc
    .from("countries")
    .select("id, name, code, external_id");
  const resolver = new CountryResolver((countryRows ?? []) as CountryRow[]);

  // Which existing matches are locked? (Don't clobber manual corrections.)
  const { data: existing } = await svc
    .from("matches")
    .select("external_id, locked")
    .not("external_id", "is", null);
  const lockedExternalIds = new Set(
    (existing ?? []).filter((m) => m.locked).map((m) => m.external_id as number),
  );

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

      if (lockedExternalIds.has(fx.fixture.id)) {
        summary.skipped_locked++;
        continue;
      }

      const row = buildMatchRow(fx, home.id, away.id);
      if (!row) continue;

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

    const { data: pending } = await svc
      .from("matches")
      .select("id, external_id, home_country_id, away_country_id")
      .eq("status", "final")
      .eq("locked", false)
      .eq("goals_synced", false)
      .not("external_id", "is", null)
      .limit(MAX_EVENT_FETCHES);

    for (const match of pending ?? []) {
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

      await svc.from("matches").update({ goals_synced: true }).eq("id", match.id as string);
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

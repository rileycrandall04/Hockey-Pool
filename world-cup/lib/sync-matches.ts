import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchWorldCupFixtures,
  fetchTopScorers,
  mapStatus,
  mapStage,
  extractMatchday,
  type RawFixture,
} from "./api-football";

export interface SyncSummary {
  fixtures_seen: number;
  matches_upserted: number;
  skipped_locked: number;
  unmatched_teams: string[];
  top_scorers: number;
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

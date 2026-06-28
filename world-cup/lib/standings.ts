import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Country,
  ScoringMatch,
  ScoredCountry,
  ScoredOwner,
  Team,
} from "./types";
import { scoreCountry, scoreOwner, rankOwners } from "./scoring";
import { computeTopScorers } from "./top-scorers";

export interface StandingRow {
  team: Team;
  ownerName: string;
  scored: ScoredOwner;
  countries: Array<{ country: Country; scored: ScoredCountry }>;
  /** True when at least one of the team's countries is in a live match. */
  live: boolean;
}

/**
 * Compute full standings for a league: every owner's drafted countries,
 * scored from the global match results, then ranked with tiebreakers.
 * Returns rows in standings order.
 */
export async function computeStandings(
  svc: SupabaseClient,
  leagueId: string,
  teams: Team[],
  ownerNames: Map<string, string>,
): Promise<StandingRow[]> {
  const [
    { data: matchRows },
    { data: countryRows },
    { data: pickRows },
    { data: adjRows },
    { data: gb },
    topScorers,
  ] = await Promise.all([
    svc.from("matches").select("*"),
    svc.from("countries").select("*"),
    svc.from("draft_picks").select("team_id, country_id").eq("league_id", leagueId),
    svc.from("score_adjustments").select("team_id, delta_points").eq("league_id", leagueId),
    svc.from("golden_boot").select("player_id").eq("league_id", leagueId).maybeSingle(),
    computeTopScorers(svc, 1),
  ]);
  const leader = topScorers[0] ?? null;

  const matches = (matchRows ?? []) as ScoringMatch[];

  // Countries currently in a live match, for the standings "playing now" cue.
  const liveCountryIds = new Set<number>();
  for (const m of matches) {
    if (m.status === "live") {
      liveCountryIds.add(m.home_country_id);
      liveCountryIds.add(m.away_country_id);
    }
  }

  const countries = (countryRows ?? []) as Country[];
  const countryById = new Map<number, Country>();
  for (const c of countries) countryById.set(c.id, c);
  const fifaRank = (id: number) => countryById.get(id)?.fifa_rank ?? null;

  // Derive who's out from the results (the DB `eliminated` flag is unmaintained).
  // A country is eliminated if it lost a knockout match, or — once the knockout
  // bracket is seeded — if it finished group play without reaching the knockouts.
  const eliminatedIds = computeEliminated(matches, countryById);

  // country_id -> team_id (who drafted it)
  const ownerOfCountry = new Map<number, string>();
  const countriesByTeam = new Map<string, number[]>();
  for (const p of pickRows ?? []) {
    ownerOfCountry.set(p.country_id as number, p.team_id as string);
    const arr = countriesByTeam.get(p.team_id as string) ?? [];
    arr.push(p.country_id as number);
    countriesByTeam.set(p.team_id as string, arr);
  }

  // Adjustments summed per team.
  const adjByTeam = new Map<string, number>();
  for (const a of adjRows ?? []) {
    if (!a.team_id) continue;
    adjByTeam.set(a.team_id as string, (adjByTeam.get(a.team_id as string) ?? 0) + Number(a.delta_points));
  }

  // Golden boot: which team (if any) owns the top scorer's country? A
  // commissioner-locked award (golden_boot.player_id) wins; otherwise we use
  // the live leader computed from our ingested goals (match_goals).
  let goldenBootCountryId: number | null = null;
  if (gb?.player_id) {
    const { data: player } = await svc
      .from("players")
      .select("country_id")
      .eq("id", gb.player_id)
      .maybeSingle();
    goldenBootCountryId = (player?.country_id as number | undefined) ?? null;
  } else if (leader?.country_id != null && leader.goals > 0) {
    goldenBootCountryId = leader.country_id;
  }
  const goldenBootTeamId =
    goldenBootCountryId != null ? ownerOfCountry.get(goldenBootCountryId) ?? null : null;

  const owners: ScoredOwner[] = teams.map((t) =>
    scoreOwner(
      {
        team_id: t.id,
        country_ids: countriesByTeam.get(t.id) ?? [],
        owns_golden_boot: goldenBootTeamId === t.id,
        adjustment_points: adjByTeam.get(t.id) ?? 0,
        over_under_guess: t.over_under_guess,
      },
      matches,
      fifaRank,
    ),
  );

  const ranked = rankOwners(owners);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  return ranked.map((scored) => {
    const team = teamById.get(scored.team_id)!;
    return {
      team,
      ownerName: ownerNames.get(team.owner_id) ?? "Player",
      scored,
      countries: scored.countries.map((sc) => ({
        country: {
          ...countryById.get(sc.country_id)!,
          eliminated: eliminatedIds.has(sc.country_id),
        },
        scored: sc,
      })),
      live: scored.countries.some((sc) => liveCountryIds.has(sc.country_id)),
    };
  });
}

/**
 * Work out which countries are eliminated from the match results, since the
 * `countries.eliminated` column isn't kept up to date by the ingestion.
 *
 * A country is out when either:
 *   - it lost a knockout match (knockouts are single-elimination — the loser of
 *     a final knockout result, on the scoreline or a shootout, is done), or
 *   - the knockout bracket has been seeded and the country finished all of its
 *     group matches without appearing anywhere in the knockout rounds.
 *
 * The second rule only fires once at least one knockout match references real
 * teams, so group sides aren't flagged mid-group-stage or before the draw.
 */
function computeEliminated(
  matches: ScoringMatch[],
  countryById: Map<number, Country>,
): Set<number> {
  const eliminated = new Set<number>();

  // Real countries that appear anywhere in the knockout rounds (= qualified).
  const knockoutCountryIds = new Set<number>();
  for (const m of matches) {
    if (m.stage === "group") continue;
    if (countryById.has(m.home_country_id)) knockoutCountryIds.add(m.home_country_id);
    if (countryById.has(m.away_country_id)) knockoutCountryIds.add(m.away_country_id);

    // Loser of a finished knockout match is out.
    if (m.status === "final" && m.home_goals != null && m.away_goals != null) {
      const homeWin =
        m.home_goals > m.away_goals ||
        (m.went_to_shootout && (m.home_pens ?? 0) > (m.away_pens ?? 0));
      const awayWin =
        m.away_goals > m.home_goals ||
        (m.went_to_shootout && (m.away_pens ?? 0) > (m.home_pens ?? 0));
      if (homeWin) eliminated.add(m.away_country_id);
      else if (awayWin) eliminated.add(m.home_country_id);
    }
  }

  // Once the bracket is set, any country that has played out its group and isn't
  // in the knockouts didn't qualify.
  if (knockoutCountryIds.size > 0) {
    const groupAllFinal = new Map<number, boolean>();
    for (const m of matches) {
      if (m.stage !== "group") continue;
      for (const cid of [m.home_country_id, m.away_country_id]) {
        const allFinal = groupAllFinal.get(cid) ?? true;
        groupAllFinal.set(cid, allFinal && m.status === "final");
      }
    }
    for (const [cid, allFinal] of groupAllFinal) {
      if (allFinal && !knockoutCountryIds.has(cid)) eliminated.add(cid);
    }
  }

  return eliminated;
}

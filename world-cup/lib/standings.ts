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
        country: countryById.get(sc.country_id)!,
        scored: sc,
      })),
      live: scored.countries.some((sc) => liveCountryIds.has(sc.country_id)),
    };
  });
}

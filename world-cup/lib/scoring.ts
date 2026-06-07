import type {
  ScoredCountry,
  ScoredOwner,
  ScoringMatch,
  Stage,
} from "./types";

// ---------------------------------------------------------------------------
// Scoring constants - the single source of truth for the league rules.
// ---------------------------------------------------------------------------

/** Points for a result in a single match. */
export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;
export const LOSS_POINTS = 0;

/** Per-goal modifiers (regulation + extra time only; shootout PKs excluded). */
export const GOAL_FOR_POINTS = 1;
export const GOAL_AGAINST_POINTS = -0.5;

/** Bonus for conceding zero in a match. */
export const CLEAN_SHEET_POINTS = 1;

/** Group-stage giant-killing: beat a higher-ranked side. */
export const UPSET_POINTS = 5;

/** Flat result for a knockout decided on penalties (no separate draw point). */
export const SHOOTOUT_WIN_POINTS = 5;
export const SHOOTOUT_LOSS_POINTS = 3;

/** Golden Boot: awarded to the owner of the tournament's top scorer. */
export const GOLDEN_BOOT_POINTS = 5;

/**
 * One-time advancement bonus, granted the moment a country appears in a
 * match at the given stage (even before kickoff). `group` and `third`
 * (third-place playoff) grant nothing.
 */
export const ADVANCEMENT_POINTS: Record<Stage, number> = {
  group: 0,
  r32: 2,
  r16: 2,
  qf: 2,
  sf: 2,
  third: 0,
  final: 2,
};

/** Additional one-time bonus for winning the final (a flat bonus). */
export const CHAMPION_POINTS = 18;

/**
 * Late-round multiplier. Match points (result, goals, clean sheet, shootout
 * bonus) earned in a semifinal or final are worth 1.5x, so the back end of the
 * bracket — and the title game especially — swings the standings. Advancement
 * bonuses and the flat champion bonus are NOT multiplied.
 */
export const ROUND_MULTIPLIER: Record<Stage, number> = {
  group: 1,
  r32: 1,
  r16: 1,
  qf: 1,
  sf: 1.5,
  third: 1,
  final: 1.5,
};

/** Chronological order used for the "furthest team" tiebreaker. */
export const STAGE_ORDER: Stage[] = [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "third",
  "final",
];

function stageOrder(stage: Stage): number {
  // Treat `third` as equivalent to `sf` for "how far did you get": a team
  // in the third-place game reached the semifinals.
  if (stage === "third") return STAGE_ORDER.indexOf("sf");
  return STAGE_ORDER.indexOf(stage);
}

// ---------------------------------------------------------------------------
// scoreCountry - the per-team engine.
// ---------------------------------------------------------------------------

/**
 * Compute every point a single national team has earned, given all matches
 * it appears in and a FIFA-rank lookup (rank at kickoff, lower = better).
 *
 * Two passes over the country's matches:
 *   1. Advancement + furthest-stage are derived from EVERY match the country
 *      appears in (scheduled, live, or final) - reaching a round is worth the
 *      bonus the instant the bracket places you there.
 *   2. Result/goals/clean-sheet/upset are only scored from FINAL matches.
 */
export function scoreCountry(
  countryId: number,
  matches: ScoringMatch[],
  fifaRank: (countryId: number) => number | null,
): ScoredCountry {
  const mine = matches.filter(
    (m) =>
      m.home_country_id === countryId || m.away_country_id === countryId,
  );

  let matchPoints = 0;
  let goalsForPoints = 0;
  let goalsAgainstPoints = 0;
  let cleanSheetPoints = 0;
  let upsetPoints = 0;
  let goalsFor = 0;
  let championPoints = 0;

  const stagesReached = new Set<Stage>();
  let furthest: Stage = "group";

  for (const m of mine) {
    stagesReached.add(m.stage);
    if (stageOrder(m.stage) > stageOrder(furthest)) furthest = m.stage;

    if (m.status !== "final") continue;

    const isHome = m.home_country_id === countryId;
    const oppId = isHome ? m.away_country_id : m.home_country_id;
    const gf = (isHome ? m.home_goals : m.away_goals) ?? 0;
    const ga = (isHome ? m.away_goals : m.home_goals) ?? 0;
    // SF/Final match points count 1.5x. Goal COUNT (tiebreaker) stays raw.
    const mult = ROUND_MULTIPLIER[m.stage];

    goalsFor += gf;
    goalsForPoints += gf * GOAL_FOR_POINTS * mult;
    goalsAgainstPoints += ga * GOAL_AGAINST_POINTS * mult;
    if (ga === 0) cleanSheetPoints += CLEAN_SHEET_POINTS * mult;

    if (m.went_to_shootout) {
      // Decided on penalties: a flat result (no separate draw point).
      const myPens = (isHome ? m.home_pens : m.away_pens) ?? 0;
      const oppPens = (isHome ? m.away_pens : m.home_pens) ?? 0;
      matchPoints += (myPens > oppPens ? SHOOTOUT_WIN_POINTS : SHOOTOUT_LOSS_POINTS) * mult;
      if (m.stage === "final" && myPens > oppPens) {
        championPoints += CHAMPION_POINTS; // flat — not multiplied
      }
    } else if (gf > ga) {
      matchPoints += WIN_POINTS * mult;
      // Upset bonus: group stage only, beating a better-ranked side.
      if (m.stage === "group") {
        const myRank = fifaRank(countryId);
        const oppRank = fifaRank(oppId);
        if (myRank != null && oppRank != null && myRank > oppRank) {
          upsetPoints += UPSET_POINTS;
        }
      }
      if (m.stage === "final") championPoints += CHAMPION_POINTS; // flat
    } else if (gf === ga) {
      matchPoints += DRAW_POINTS * mult;
    } else {
      matchPoints += LOSS_POINTS * mult;
    }
  }

  let advancementPoints = 0;
  for (const stage of stagesReached) advancementPoints += ADVANCEMENT_POINTS[stage];

  const total =
    matchPoints +
    goalsForPoints +
    goalsAgainstPoints +
    cleanSheetPoints +
    upsetPoints +
    advancementPoints +
    championPoints;

  return {
    country_id: countryId,
    match_points: matchPoints,
    goals_for_points: goalsForPoints,
    goals_against_points: goalsAgainstPoints,
    clean_sheet_points: cleanSheetPoints,
    upset_points: upsetPoints,
    advancement_points: advancementPoints,
    champion_points: championPoints,
    total,
    goals_for: goalsFor,
    furthest_stage: furthest,
  };
}

// ---------------------------------------------------------------------------
// scoreOwner - roll a fantasy owner's drafted countries into one total.
// ---------------------------------------------------------------------------

export interface OwnerInput {
  team_id: string;
  country_ids: number[];
  /** True if this owner drafted the country of the current top scorer. */
  owns_golden_boot: boolean;
  /** Net commissioner adjustment (can be +/-). */
  adjustment_points?: number;
  over_under_guess?: number | null;
}

export function scoreOwner(
  owner: OwnerInput,
  matches: ScoringMatch[],
  fifaRank: (countryId: number) => number | null,
): ScoredOwner {
  const countries = owner.country_ids.map((id) =>
    scoreCountry(id, matches, fifaRank),
  );

  const goldenBootPoints = owner.owns_golden_boot ? GOLDEN_BOOT_POINTS : 0;
  const adjustmentPoints = owner.adjustment_points ?? 0;

  const countryTotal = countries.reduce((s, c) => s + c.total, 0);
  const total = countryTotal + goldenBootPoints + adjustmentPoints;

  const goalsFor = countries.reduce((s, c) => s + c.goals_for, 0);
  const furthestStageOrder = countries.reduce(
    (max, c) => Math.max(max, stageOrder(c.furthest_stage)),
    0,
  );

  return {
    team_id: owner.team_id,
    countries,
    golden_boot_points: goldenBootPoints,
    adjustment_points: adjustmentPoints,
    total,
    tiebreak: {
      goals_for: goalsFor,
      furthest_stage_order: furthestStageOrder,
      over_under_guess: owner.over_under_guess ?? null,
    },
  };
}

/**
 * Sort owners into standings order, applying the tiebreakers in sequence:
 *   1. total points (desc)
 *   2. total goals scored by owned countries (desc)
 *   3. furthest-advancing country (desc)
 *   4. closest pre-draft over/under guess to the owner's actual total (asc)
 *
 * Owners with no over/under guess sort last within an otherwise-exact tie.
 */
export function rankOwners(owners: ScoredOwner[]): ScoredOwner[] {
  return [...owners].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.tiebreak.goals_for !== a.tiebreak.goals_for)
      return b.tiebreak.goals_for - a.tiebreak.goals_for;
    if (b.tiebreak.furthest_stage_order !== a.tiebreak.furthest_stage_order)
      return b.tiebreak.furthest_stage_order - a.tiebreak.furthest_stage_order;

    const aDelta =
      a.tiebreak.over_under_guess == null
        ? Number.POSITIVE_INFINITY
        : Math.abs(a.total - a.tiebreak.over_under_guess);
    const bDelta =
      b.tiebreak.over_under_guess == null
        ? Number.POSITIVE_INFINITY
        : Math.abs(b.total - b.tiebreak.over_under_guess);
    return aDelta - bDelta;
  });
}

/**
 * Generate a human-friendly, unambiguous join code.
 * Avoids confusing characters (0/O, 1/I/L).
 */
export function generateJoinCode(length = 6): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

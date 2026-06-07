// ---------------------------------------------------------------------------
// Shared domain types for the World Cup draft pool.
// ---------------------------------------------------------------------------

export type DraftStatus = "pending" | "in_progress" | "complete";
export type DraftType = "manual" | "auto";

/**
 * Tournament stages, in chronological order. `third` is the third-place
 * playoff (SF losers); it is a scored match but grants no advancement bonus.
 */
export type Stage =
  | "group"
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "third"
  | "final";

export type MatchStatus = "scheduled" | "live" | "final";

export type GoalType = "regular" | "penalty" | "own_goal";

export interface Profile {
  id: string;
  display_name: string;
  email: string | null;
}

export interface League {
  id: string;
  name: string;
  season: string;
  commissioner_id: string;
  join_code: string;
  /** Countries each owner drafts. 12 owners x 4 = the full 48-team field. */
  roster_size: number;
  draft_status: DraftStatus;
  draft_type: DraftType;
  draft_current_team: string | null;
  draft_round: number;
  draft_started_at: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  league_id: string;
  owner_id: string;
  name: string;
  draft_position: number | null;
  /** Secret pre-draft guess of this roster's final total (final tiebreaker). */
  over_under_guess: number | null;
  created_at: string;
}

/** A national team - the unit that gets drafted (the 48-team field). */
export interface Country {
  id: number;
  name: string;
  /** 3-letter FIFA/ISO code, e.g. "BRA", "USA". */
  code: string;
  flag_url: string | null;
  confederation: string | null;
  group_letter: string | null;
  /** FIFA world ranking frozen at kickoff. Drives the upset bonus. */
  fifa_rank: number | null;
  eliminated: boolean;
  /** API-Football team id, for ingestion mapping. */
  external_id: number | null;
  /** Hand-edited in the admin editor; the API sync leaves these alone. */
  manual_override?: boolean;
}

/** A player, lazily upserted from goal events for the Golden Boot race. */
export interface Player {
  id: number;
  country_id: number;
  name: string;
  external_id: number | null;
}

export interface Match {
  id: string;
  stage: Stage;
  /** 1-3 for group matchdays; null for knockout rounds. */
  matchday: number | null;
  home_country_id: number;
  away_country_id: number;
  kickoff_utc: string | null;
  status: MatchStatus;
  /** Goals in regulation + extra time only (shootout PKs excluded). */
  home_goals: number | null;
  away_goals: number | null;
  went_to_shootout: boolean;
  home_pens: number | null;
  away_pens: number | null;
  /** Set when a commissioner manually edits the result; blocks API overwrite. */
  locked: boolean;
  external_id: number | null;
}

export interface MatchGoal {
  id: string;
  match_id: string;
  country_id: number;
  scorer_player_id: number | null;
  minute: number | null;
  type: GoalType;
  is_shootout: boolean;
}

// ---------------------------------------------------------------------------
// Scoring engine inputs/outputs (DB-agnostic so they are easy to unit test).
// ---------------------------------------------------------------------------

/** The minimal shape `scoreCountry` needs from a match row. */
export interface ScoringMatch {
  id: string;
  stage: Stage;
  status: MatchStatus;
  home_country_id: number;
  away_country_id: number;
  home_goals: number | null;
  away_goals: number | null;
  went_to_shootout: boolean;
  home_pens: number | null;
  away_pens: number | null;
}

/** Itemised point breakdown for a single country. */
export interface ScoredCountry {
  country_id: number;
  match_points: number;
  goals_for_points: number;
  goals_against_points: number;
  clean_sheet_points: number;
  upset_points: number;
  advancement_points: number;
  champion_points: number;
  runner_up_points: number;
  third_place_points: number;
  total: number;
  // Tiebreaker data.
  goals_for: number;
  furthest_stage: Stage;
}

export interface ScoredOwner {
  team_id: string;
  countries: ScoredCountry[];
  golden_boot_points: number;
  adjustment_points: number;
  total: number;
  tiebreak: {
    goals_for: number;
    furthest_stage_order: number;
    over_under_guess: number | null;
  };
}

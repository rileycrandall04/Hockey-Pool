export type Position = "C" | "L" | "R" | "F" | "D" | "G";

export type DraftStatus = "pending" | "in_progress" | "complete";
export type DraftType = "manual" | "auto";

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
  roster_size: number;
  scoring_roster_size: number;
  required_defensemen: number;
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
  created_at: string;
}

export interface NhlTeam {
  id: number;
  abbrev: string;
  name: string;
  conference: string | null;
  logo_url: string | null;
  eliminated: boolean;
}

export interface Player {
  id: number;
  full_name: string;
  position: Position;
  nhl_team_id: number | null;
  jersey_number: number | null;
  headshot_url: string | null;
  active: boolean;
  season_goals: number;
  season_assists: number;
  season_points: number;
  season_games_played: number;
  injury_status: string | null;
  injury_description: string | null;
}

export interface DailyRecap {
  id: string;
  game_date: string;
  game_id: number;
  away_team_abbrev: string;
  away_team_score: number;
  home_team_abbrev: string;
  home_team_score: number;
  game_state: string;
  was_overtime: boolean;
  scorers: Array<{
    player_id: number;
    name: string;
    team: string;
    goals: number;
    assists: number;
  }>;
}

export interface PlayerStats {
  player_id: number;
  games_played: number;
  goals: number;
  assists: number;
  ot_goals: number;
  fantasy_points: number;
  updated_at: string;
}

export interface RosterEntry {
  league_id: string;
  team_id: string;
  player_id: number;
  round: number;
  pick_number: number;
  full_name: string;
  position: Position;
  nhl_team_id: number | null;
  nhl_abbrev: string | null;
  nhl_logo: string | null;
  goals: number;
  assists: number;
  ot_goals: number;
  fantasy_points: number;
  games_played: number;
}

export interface PlayoffSeries {
  series_letter: string;
  season: string;
  round: number;
  series_title: string | null;
  series_abbrev: string | null;
  top_seed_abbrev: string | null;
  top_seed_name: string | null;
  top_seed_logo: string | null;
  top_seed_wins: number;
  bottom_seed_abbrev: string | null;
  bottom_seed_name: string | null;
  bottom_seed_logo: string | null;
  bottom_seed_wins: number;
  winning_team_abbrev: string | null;
  needed_to_win: number;
  sort_order: number;
  updated_at: string;
}

export interface PlayoffBroadcast {
  network: string;
  market: string | null;
  countryCode: string | null;
}

export interface PlayoffGame {
  game_id: number;
  series_letter: string;
  game_number: number | null;
  start_time_utc: string | null;
  game_date: string | null;
  venue: string | null;
  away_abbrev: string | null;
  home_abbrev: string | null;
  away_score: number | null;
  home_score: number | null;
  game_state: string | null;
  tv_broadcasts: PlayoffBroadcast[];
  updated_at: string;
}

export interface ManualGameStat {
  id: string;
  game_id: number;
  player_id: number;
  goals: number;
  assists: number;
  ot_goals: number;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatConflict {
  id: string;
  game_id: number;
  player_id: number;
  manual_goals: number;
  manual_assists: number;
  manual_ot_goals: number;
  cron_goals: number;
  cron_assists: number;
  cron_ot_goals: number;
  resolved: boolean;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

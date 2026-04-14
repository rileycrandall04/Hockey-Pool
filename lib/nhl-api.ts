/**
 * Thin wrapper around the public NHL API (api-web.nhle.com).
 *
 * These endpoints are unofficial but stable enough for a fantasy pool.
 * Docs that the community maintains:
 *   https://github.com/Zmalski/NHL-API-Reference
 */

import type { Position } from "./types";

const BASE = process.env.NHL_API_BASE ?? "https://api-web.nhle.com/v1";

async function nhlFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    // Cache briefly so cron retries don't hammer the API.
    next: { revalidate: 60 },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`NHL API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ----- types from the NHL API --------------------------------------------

interface NhlRosterResponse {
  forwards: NhlRosterPlayer[];
  defensemen: NhlRosterPlayer[];
  goalies: NhlRosterPlayer[];
}

interface NhlRosterPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber?: number;
  positionCode: string;
  headshot?: string;
}

interface NhlStandingsResponse {
  standings: Array<{
    teamAbbrev: { default: string };
    teamName: { default: string };
    conferenceName: string;
    teamLogo: string;
    clinchIndicator?: string;
    leagueSequence: number;
  }>;
}

interface NhlScheduleResponse {
  gameWeek: Array<{
    date: string;
    games: Array<{
      id: number;
      gameDate: string;
      gameState: string; // "FINAL", "OFF", "LIVE", "FUT", etc.
      homeTeam: { id: number; abbrev: string };
      awayTeam: { id: number; abbrev: string };
    }>;
  }>;
}

interface NhlBoxscoreResponse {
  id: number;
  gameState: string;
  periodDescriptor?: { number: number };
  summary?: {
    scoring?: Array<{
      periodDescriptor: { number: number; periodType: string };
      goals: Array<{
        playerId: number;
        assists: Array<{ playerId: number }>;
        timeInPeriod?: string;
      }>;
    }>;
  };
  playerByGameStats?: {
    homeTeam: { forwards: NhlBoxPlayer[]; defense: NhlBoxPlayer[] };
    awayTeam: { forwards: NhlBoxPlayer[]; defense: NhlBoxPlayer[] };
  };
}

interface NhlBoxPlayer {
  playerId: number;
  goals?: number;
  assists?: number;
}

interface NhlClubStatsResponse {
  skaters?: Array<{
    playerId: number;
    goals?: number;
    assists?: number;
    points?: number;
    gamesPlayed?: number;
  }>;
  goalies?: Array<{
    playerId: number;
    gamesPlayed?: number;
  }>;
}

interface NhlPlayerLandingResponse {
  playerId: number;
  currentInjury?: {
    description?: string;
    duration?: string;
  };
}

interface NhlGameLandingResponse {
  id: number;
  gameDate: string;
  gameState: string;
  awayTeam: { abbrev: string; score: number; name?: { default: string } };
  homeTeam: { abbrev: string; score: number; name?: { default: string } };
  periodDescriptor?: { number: number; periodType: string };
  summary?: {
    scoring?: Array<{
      periodDescriptor: { number: number; periodType: string };
      goals: Array<{
        playerId: number;
        firstName?: { default: string };
        lastName?: { default: string };
        teamAbbrev?: { default: string };
        assists: Array<{
          playerId: number;
          firstName?: { default: string };
          lastName?: { default: string };
        }>;
      }>;
    }>;
  };
}

interface NhlStandingsClinchResponse {
  standings: Array<{
    teamAbbrev: { default: string };
    clinchIndicator?: string;
    leagueSequence?: number;
    wildcardSequence?: number;
  }>;
}

// ----- helpers -----------------------------------------------------------

export function normalizePosition(code: string): Position {
  const c = code.toUpperCase();
  if (c === "C" || c === "L" || c === "R" || c === "D" || c === "G") return c;
  return "F";
}

export interface NhlTeamSummary {
  abbrev: string;
  name: string;
  conference: string;
  logo_url: string;
}

/**
 * Fetch all current NHL team summaries.
 * Used to seed `nhl_teams` with the 16 playoff teams.
 */
export async function fetchAllTeams(): Promise<NhlTeamSummary[]> {
  const data = await nhlFetch<NhlStandingsResponse>("/standings/now");
  return data.standings.map((t) => ({
    abbrev: t.teamAbbrev.default,
    name: t.teamName.default,
    conference: t.conferenceName,
    logo_url: t.teamLogo,
  }));
}

export interface NhlPlayerSummary {
  id: number;
  full_name: string;
  position: Position;
  nhl_team_abbrev: string;
  jersey_number: number | null;
  headshot_url: string | null;
}

/**
 * Fetch a single team's roster. Use with each playoff team to build
 * the draftable player pool.
 */
export async function fetchTeamRoster(
  abbrev: string,
): Promise<NhlPlayerSummary[]> {
  const data = await nhlFetch<NhlRosterResponse>(
    `/roster/${abbrev}/current`,
  );

  const out: NhlPlayerSummary[] = [];
  const push = (p: NhlRosterPlayer) => {
    out.push({
      id: p.id,
      full_name: `${p.firstName.default} ${p.lastName.default}`,
      position: normalizePosition(p.positionCode),
      nhl_team_abbrev: abbrev,
      jersey_number: p.sweaterNumber ?? null,
      headshot_url: p.headshot ?? null,
    });
  };

  data.forwards.forEach(push);
  data.defensemen.forEach(push);
  data.goalies.forEach(push);
  return out;
}

/**
 * Fetch every final game from a specific date (YYYY-MM-DD).
 * The NHL schedule endpoint returns a week at a time; we filter to
 * the requested date.
 */
export async function fetchCompletedGamesOnDate(
  date: string,
): Promise<number[]> {
  const data = await nhlFetch<NhlScheduleResponse>(`/schedule/${date}`);
  const day = data.gameWeek.find((d) => d.date === date);
  if (!day) return [];
  return day.games
    .filter((g) => g.gameState === "OFF" || g.gameState === "FINAL")
    .map((g) => g.id);
}

export interface GamePlayerLine {
  playerId: number;
  goals: number;
  assists: number;
  otGoals: number;
}

/**
 * Fetch a finished game and emit per-player deltas to apply.
 *
 * We detect OT goals by finding goals scored in periodDescriptor.number >= 4
 * in the regular season / > 4 during playoffs where period 4 is OT1, etc.
 * We only count OT goals that are also regular goals (same playerId) — no
 * double-counting.
 */
export async function fetchGameStats(
  gameId: number,
): Promise<GamePlayerLine[]> {
  const data = await nhlFetch<NhlBoxscoreResponse>(
    `/gamecenter/${gameId}/boxscore`,
  );
  const byPlayer = new Map<number, GamePlayerLine>();
  const ensure = (id: number): GamePlayerLine => {
    let row = byPlayer.get(id);
    if (!row) {
      row = { playerId: id, goals: 0, assists: 0, otGoals: 0 };
      byPlayer.set(id, row);
    }
    return row;
  };

  const skaters = [
    ...(data.playerByGameStats?.homeTeam.forwards ?? []),
    ...(data.playerByGameStats?.homeTeam.defense ?? []),
    ...(data.playerByGameStats?.awayTeam.forwards ?? []),
    ...(data.playerByGameStats?.awayTeam.defense ?? []),
  ];
  for (const p of skaters) {
    const row = ensure(p.playerId);
    row.goals += p.goals ?? 0;
    row.assists += p.assists ?? 0;
  }

  // Detect OT goals from the scoring summary.
  // In playoffs, period 4+ = overtime.
  const scoring = data.summary?.scoring ?? [];
  for (const period of scoring) {
    const isOt =
      period.periodDescriptor.periodType === "OT" ||
      period.periodDescriptor.number >= 4;
    if (!isOt) continue;
    for (const g of period.goals) {
      ensure(g.playerId).otGoals += 1;
    }
  }

  return [...byPlayer.values()].filter(
    (r) => r.goals || r.assists || r.otGoals,
  );
}

// ----- season stats per team --------------------------------------------

export interface NhlSeasonStat {
  playerId: number;
  goals: number;
  assists: number;
  points: number;
  gamesPlayed: number;
}

export interface TeamStatsResult {
  rows: NhlSeasonStat[];
  source: "season" | "now" | "none";
  error?: string;
}

function parseSkaters(data: NhlClubStatsResponse): NhlSeasonStat[] {
  const skaters = data.skaters ?? [];
  return skaters.map((s) => ({
    playerId: s.playerId,
    goals: s.goals ?? 0,
    assists: s.assists ?? 0,
    points: s.points ?? ((s.goals ?? 0) + (s.assists ?? 0)),
    gamesPlayed: s.gamesPlayed ?? 0,
  }));
}

/**
 * Fetch every skater's regular-season stats for a team.
 *
 * Strategy:
 *   1. Try the explicit season endpoint:
 *        /club-stats/{abbrev}/{season}/2     (gameType 2 = regular season)
 *      This is the documented path on the public NHL API.
 *   2. If that returns 0 skaters or errors, fall back to the "current"
 *      alias which doesn't require us to compute a season string:
 *        /club-stats/{abbrev}/now
 *      The "now" endpoint sometimes works for teams the season-specific
 *      one doesn't, especially around offseason / playoff transitions.
 *   3. If both fail, return source="none" with the error message so
 *      callers (the seeder, the debug page) can show it to the user
 *      instead of silently dropping the team's data.
 *
 * Returns the rows + which source was used + the last error if any.
 */
export async function fetchTeamSeasonStats(
  abbrev: string,
  season: string,
): Promise<TeamStatsResult> {
  let lastError: string | undefined;

  // Attempt 1: explicit season + gameType
  try {
    const data = await nhlFetch<NhlClubStatsResponse>(
      `/club-stats/${abbrev}/${season}/2`,
    );
    const rows = parseSkaters(data);
    if (rows.length > 0) return { rows, source: "season" };
    lastError = `season endpoint returned 0 skaters`;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  // Attempt 2: "now" alias
  try {
    const data = await nhlFetch<NhlClubStatsResponse>(
      `/club-stats/${abbrev}/now`,
    );
    const rows = parseSkaters(data);
    if (rows.length > 0) return { rows, source: "now" };
    lastError = `now endpoint returned 0 skaters (previous: ${lastError})`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = `${msg} (previous: ${lastError})`;
  }

  return { rows: [], source: "none", error: lastError };
}

/**
 * Resolve the "current" NHL season string in the format the club-stats
 * endpoint expects ("YYYYYYYY"). The NHL season starts in October of one
 * calendar year and ends in June of the next, so we use Oct 1 as the
 * cutover date.
 */
export function currentSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-12
  if (month >= 10) {
    return `${year}${year + 1}`;
  }
  return `${year - 1}${year}`;
}

// ----- per-player injury status -----------------------------------------

export interface PlayerInjuryInfo {
  status: string | null;
  description: string | null;
  source: "currentInjury" | "inGameStatus" | "scratched" | "none" | "error";
  error?: string;
}

/**
 * Best-effort fetch of a single player's current injury status.
 *
 * The NHL public API does not have a dedicated injury report endpoint
 * and the player landing payload's shape has shifted over time. We
 * try every field name the community has documented and return on
 * the first match:
 *
 *   1. data.currentInjury  — { description?, duration? }
 *   2. data.injury         — older shape, same fields
 *   3. data.inGameStatus / inLineup === false → "scratched"
 *
 * If none of those match we return source="none" (healthy as far as
 * we know). Errors are surfaced via source="error" + the message.
 *
 * Returns the raw `currentInjury`-shaped result so the cron and
 * /debug/nhl can both use it without duplicating the parser.
 */
export async function fetchPlayerInjury(
  playerId: number,
): Promise<PlayerInjuryInfo> {
  try {
    const data = await nhlFetch<Record<string, unknown>>(
      `/player/${playerId}/landing`,
    );

    // Shape 1: currentInjury
    const cur = data.currentInjury as
      | { description?: string; duration?: string }
      | undefined;
    if (cur && (cur.description || cur.duration)) {
      return {
        status: cur.duration ?? "Injured",
        description: cur.description ?? null,
        source: "currentInjury",
      };
    }

    // Shape 2: legacy "injury"
    const legacy = data.injury as
      | { description?: string; duration?: string }
      | undefined;
    if (legacy && (legacy.description || legacy.duration)) {
      return {
        status: legacy.duration ?? "Injured",
        description: legacy.description ?? null,
        source: "currentInjury",
      };
    }

    // Shape 3: scratch / lineup status
    const inLineup = data.inLineup;
    const inGameStatus = data.inGameStatus as string | undefined;
    if (inLineup === false || inGameStatus === "SCRATCH") {
      return {
        status: "Scratched",
        description: typeof inGameStatus === "string" ? inGameStatus : null,
        source: "scratched",
      };
    }

    return { status: null, description: null, source: "none" };
  } catch (err) {
    return {
      status: null,
      description: null,
      source: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Raw fetch of /player/{id}/landing. Used by the debug page so we can
 * see exactly what fields the API is returning for a given player and
 * adjust the parser if the shape shifts.
 */
export async function fetchPlayerLandingRaw(
  playerId: number,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const data = await nhlFetch<unknown>(`/player/${playerId}/landing`);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ----- playoff elimination detection ------------------------------------

/**
 * Pull the current standings and return the abbrevs of any team marked
 * as eliminated. Best-effort: returns an empty set on failure.
 *
 * The NHL API uses the `clinchIndicator` field on each standings row
 * during the regular season; values include "x" (clinched playoff
 * berth), "y" (clinched division), "p" (presidents trophy), and "e"
 * (eliminated from playoff contention). After the playoffs start, the
 * standings endpoint is less authoritative — eliminated teams should
 * also be detectable via the playoff bracket endpoint, but we keep the
 * cron simple and rely on commissioner overrides for that.
 */
export async function fetchEliminatedTeams(): Promise<Set<string>> {
  try {
    const data = await nhlFetch<NhlStandingsClinchResponse>("/standings/now");
    const out = new Set<string>();
    for (const row of data.standings) {
      if (row.clinchIndicator === "e") {
        out.add(row.teamAbbrev.default);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

// ----- game recaps for the home page ticker -----------------------------

export interface GameRecap {
  gameId: number;
  gameDate: string;
  gameState: string;
  awayAbbrev: string;
  awayScore: number;
  homeAbbrev: string;
  homeScore: number;
  wasOvertime: boolean;
  scorers: Array<{
    player_id: number;
    name: string;
    team: string;
    goals: number;
    assists: number;
  }>;
}

/**
 * Fetch a single finished game and reduce it down to a ticker-friendly
 * shape: final scores plus an aggregated list of every player who got a
 * goal or an assist in the game. Returns null on failure.
 */
export async function fetchGameRecap(
  gameId: number,
): Promise<GameRecap | null> {
  try {
    const data = await nhlFetch<NhlGameLandingResponse>(
      `/gamecenter/${gameId}/landing`,
    );

    // Walk the scoring summary and tally G/A per player.
    type Tally = {
      player_id: number;
      name: string;
      team: string;
      goals: number;
      assists: number;
    };
    const byPlayer = new Map<number, Tally>();
    let wasOvertime = false;

    for (const period of data.summary?.scoring ?? []) {
      const isOt =
        period.periodDescriptor.periodType === "OT" ||
        period.periodDescriptor.number >= 4;
      if (isOt) wasOvertime = true;

      for (const goal of period.goals) {
        const scorerName =
          `${goal.firstName?.default ?? ""} ${goal.lastName?.default ?? ""}`.trim() ||
          `#${goal.playerId}`;
        const scorerTeam = goal.teamAbbrev?.default ?? "";
        const scorer =
          byPlayer.get(goal.playerId) ?? {
            player_id: goal.playerId,
            name: scorerName,
            team: scorerTeam,
            goals: 0,
            assists: 0,
          };
        scorer.goals += 1;
        byPlayer.set(goal.playerId, scorer);

        for (const a of goal.assists ?? []) {
          const assistName =
            `${a.firstName?.default ?? ""} ${a.lastName?.default ?? ""}`.trim() ||
            `#${a.playerId}`;
          const helper =
            byPlayer.get(a.playerId) ?? {
              player_id: a.playerId,
              name: assistName,
              team: scorerTeam,
              goals: 0,
              assists: 0,
            };
          helper.assists += 1;
          byPlayer.set(a.playerId, helper);
        }
      }
    }

    return {
      gameId: data.id,
      gameDate: data.gameDate,
      gameState: data.gameState,
      awayAbbrev: data.awayTeam.abbrev,
      awayScore: data.awayTeam.score ?? 0,
      homeAbbrev: data.homeTeam.abbrev,
      homeScore: data.homeTeam.score ?? 0,
      wasOvertime,
      scorers: [...byPlayer.values()],
    };
  } catch {
    return null;
  }
}

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

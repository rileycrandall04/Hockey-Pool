// ---------------------------------------------------------------------------
// Minimal API-Football (api-sports.io) client for the 2026 World Cup.
//
// Free tier: 100 req/day, all endpoints. We only use two:
//   - /fixtures        (all WC matches: scores, status, shootouts)
//   - /players/topscorers  (the live Golden Boot leaderboard)
//
// Auth header is `x-apisports-key` for the direct api-sports.io host.
// ---------------------------------------------------------------------------

import type { Stage, MatchStatus } from "./types";

const BASE = process.env.API_FOOTBALL_BASE ?? "https://v3.football.api-sports.io";
const LEAGUE = process.env.API_FOOTBALL_WC_LEAGUE_ID ?? "1";
const SEASON = process.env.API_FOOTBALL_WC_SEASON ?? "2026";

export class ApiFootballError extends Error {}

async function apiGet(path: string, params: Record<string, string>): Promise<unknown[]> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new ApiFootballError("API_FOOTBALL_KEY is not set");

  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": key },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiFootballError(`API-Football ${path} returned ${res.status}`);
  }
  const json = (await res.json()) as { response?: unknown[]; errors?: unknown };
  // API-Football returns 200 with an `errors` object on quota/param problems.
  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length > 0) {
    throw new ApiFootballError(`API-Football ${path}: ${JSON.stringify(json.errors)}`);
  }
  return json.response ?? [];
}

// ---- Shapes we actually read (loose; the API has many more fields) --------

export interface RawFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed: number | null };
  };
  league: { round: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null }; // reg + ET, no PKs
  score: {
    penalty: { home: number | null; away: number | null };
  };
}

export interface RawTopScorer {
  player: { id: number; name: string };
  statistics: Array<{
    team: { id: number; name: string };
    goals: { total: number | null; assists: number | null };
    games: { minutes: number | null };
  }>;
}

export interface RawEvent {
  time: { elapsed: number | null; extra: number | null };
  team: { id: number; name: string };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string; // "Goal", "Card", "subst", "Var"
  detail: string; // "Normal Goal", "Penalty", "Own Goal", "Missed Penalty"
  comments: string | null;
}

/** Match events (goals, cards, subs) for a single fixture. */
export async function fetchFixtureEvents(fixtureId: number): Promise<RawEvent[]> {
  return (await apiGet("fixtures/events", {
    fixture: String(fixtureId),
  })) as RawEvent[];
}

/** All World Cup fixtures, optionally narrowed to a [from, to] date window. */
export async function fetchWorldCupFixtures(window?: {
  from?: string;
  to?: string;
}): Promise<RawFixture[]> {
  const params: Record<string, string> = { league: LEAGUE, season: SEASON };
  if (window?.from) params.from = window.from;
  if (window?.to) params.to = window.to;
  return (await apiGet("fixtures", params)) as RawFixture[];
}

/** The current top-scorers leaderboard (the Golden Boot race). */
export async function fetchTopScorers(): Promise<RawTopScorer[]> {
  return (await apiGet("players/topscorers", {
    league: LEAGUE,
    season: SEASON,
  })) as RawTopScorer[];
}

export interface RawTeam {
  team: { id: number; name: string; code: string | null; logo: string | null; national: boolean };
}

/** The teams participating in the World Cup competition. */
export async function fetchWorldCupTeams(): Promise<RawTeam[]> {
  return (await apiGet("teams", { league: LEAGUE, season: SEASON })) as RawTeam[];
}

export interface RawStandingRow {
  team: { id: number; name: string };
  group: string; // e.g. "Group A"
}

/**
 * The competition standings, flattened to one row per team. For group
 * tournaments API-Football nests standings as response[0].league.standings
 * (an array of group tables). Each row carries its group label, which is
 * what we use to assign group letters. May be empty before kickoff.
 */
export async function fetchWorldCupStandings(): Promise<RawStandingRow[]> {
  const resp = await apiGet("standings", { league: LEAGUE, season: SEASON });
  const first = resp[0] as { league?: { standings?: RawStandingRow[][] } } | undefined;
  const groups = first?.league?.standings ?? [];
  return groups.flat();
}

/** Extract the group letter ("Group A" -> "A") from a standings label. */
export function groupLetter(label: string): string | null {
  const m = label.match(/group\s+([a-l])/i);
  return m ? m[1].toUpperCase() : null;
}

// ---- Mappers ---------------------------------------------------------------

/** Map an API-Football status short code to our match status. */
export function mapStatus(short: string): MatchStatus {
  const s = short.toUpperCase();
  if (["FT", "AET", "PEN", "WO"].includes(s)) return "final";
  if (["NS", "TBD", "PST", "CANC", "ABD", "SUSP"].includes(s)) return "scheduled";
  return "live"; // 1H, HT, 2H, ET, BT, P, INT, LIVE
}

/**
 * Map an API-Football "round" string to our tournament stage. Returns null
 * if it can't be classified. Order matters: check the more specific labels
 * (3rd place, semi, quarter) before the bare "final".
 */
export function mapStage(round: string): Stage | null {
  const r = round.toLowerCase();
  if (r.includes("group")) return "group";
  if (r.includes("3rd place") || r.includes("third place")) return "third";
  if (r.includes("round of 32")) return "r32";
  if (r.includes("round of 16")) return "r16";
  if (r.includes("quarter")) return "qf";
  if (r.includes("semi")) return "sf";
  if (r.includes("final")) return "final";
  return null;
}

/** Pull the matchday number out of a "Group Stage - 2" style round label. */
export function extractMatchday(round: string): number | null {
  const m = round.match(/-\s*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

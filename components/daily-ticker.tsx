import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { todayEasternISO, isGameOnDate } from "@/lib/playoff-helpers";
import type { DailyRecap } from "@/lib/types";
import { DailyTickerClient } from "./daily-ticker-client";

/**
 * Server-side data loader for the daily scores ticker.
 *
 * Time-based switching (Mountain Daylight Time):
 *   - Before 10:00 AM MDT → show yesterday's games ("Last Night")
 *   - After  10:00 AM MDT → show today's games ("Today")
 *
 * Always pulls from playoff_games + manual_game_stats so stat
 * updates are immediately reflected. Falls back to the other day
 * if the primary date has no games.
 */
export async function DailyTicker({ leagueId }: { leagueId?: string } = {}) {
  const svc = createServiceClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = isAppOwner(user?.email);

  // Team logos + id→abbrev lookup
  const { data: nhlTeamRows } = await svc
    .from("nhl_teams")
    .select("id, abbrev, logo_url");
  const teamLogos: Record<string, string> = {};
  const teamIdToAbbrev = new Map<number, string>();
  for (const t of (nhlTeamRows ?? []) as { id: number; abbrev: string; logo_url: string | null }[]) {
    if (t.logo_url) teamLogos[t.abbrev] = t.logo_url;
    teamIdToAbbrev.set(t.id, t.abbrev);
  }

  // ── Determine which date to show ──────────────────────────────────
  // Ticker uses 10:00 AM MDT cutover (separate from the app-wide
  // 4:30 AM cutover). Before 10 AM show yesterday, after show today.
  const now = new Date();
  const mdtStr = now.toLocaleString("en-US", {
    timeZone: "America/Denver",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [mdtH, mdtM] = mdtStr.split(":").map(Number);
  const mdtMinutes = (mdtH ?? 0) * 60 + (mdtM ?? 0);
  const showToday = mdtMinutes >= 10 * 60; // 10:00 AM MDT

  const today = todayEasternISO();
  const yesterdayDate = new Date(`${today}T12:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

  const primaryDate = showToday ? today : yesterday;
  const fallbackDate = showToday ? yesterday : today;
  const primaryLabel = showToday ? "Today" : "Last Night";
  const fallbackLabel = showToday ? "Last Night" : "Today";

  // ── Fetch all playoff games ───────────────────────────────────────
  const { data: allPlayoffGames } = await svc
    .from("playoff_games")
    .select("*")
    .order("game_id", { ascending: true });

  const allGames = (allPlayoffGames ?? []);

  // Try primary date first, fall back if no games
  let targetDate = primaryDate;
  let label = primaryLabel;
  let dateGames = filterAndDedup(allGames, targetDate);

  if (dateGames.length === 0) {
    targetDate = fallbackDate;
    label = fallbackLabel;
    dateGames = filterAndDedup(allGames, targetDate);
  }

  if (dateGames.length === 0) return null;

  // ── Fetch manual stats for these games ────────────────────────────
  const gameIds = dateGames.map((g) => g.game_id);
  const { data: statRows } = await svc
    .from("manual_game_stats")
    .select("game_id, player_id, goals, assists, ot_goals")
    .in("game_id", gameIds);

  // Player name lookup
  const playerIds = [
    ...new Set((statRows ?? []).map((s: { player_id: number }) => s.player_id)),
  ];
  const playerNames = new Map<number, { name: string; nhl_team_id: number }>();
  if (playerIds.length > 0) {
    const { data: players } = await svc
      .from("players")
      .select("id, full_name, nhl_team_id")
      .in("id", playerIds);
    for (const p of players ?? []) {
      playerNames.set(p.id, { name: p.full_name, nhl_team_id: p.nhl_team_id });
    }
  }

  // ── Build DailyRecap objects for every game on this date ──────────
  const recaps: DailyRecap[] = dateGames.map((g) => {
    const gameStats = (statRows ?? []).filter(
      (s: { game_id: number }) => s.game_id === g.game_id,
    );
    const scorers = gameStats
      .filter(
        (s: { goals: number; assists: number }) =>
          s.goals > 0 || s.assists > 0,
      )
      .map(
        (s: {
          player_id: number;
          goals: number;
          assists: number;
          ot_goals: number;
        }) => {
          const info = playerNames.get(s.player_id);
          const abbrev = info
            ? teamIdToAbbrev.get(info.nhl_team_id) ?? "?"
            : "?";
          return {
            player_id: s.player_id,
            name: info?.name ?? `Player ${s.player_id}`,
            team: abbrev,
            goals: s.goals,
            assists: s.assists,
          };
        },
      )
      .sort(
        (
          a: { goals: number; assists: number },
          b: { goals: number; assists: number },
        ) => b.goals + b.assists - (a.goals + a.assists),
      );

    const hasOT = gameStats.some(
      (s: { ot_goals: number }) => s.ot_goals > 0,
    );
    const hasScore = g.away_score != null && g.home_score != null;
    const isFinal = g.game_state === "FINAL" || g.game_state === "OFF";

    return {
      id: `game-${g.game_id}`,
      game_date: g.game_date ?? targetDate,
      game_id: g.game_id,
      away_team_abbrev: g.away_abbrev ?? "?",
      away_team_score: g.away_score ?? 0,
      home_team_abbrev: g.home_abbrev ?? "?",
      home_team_score: g.home_score ?? 0,
      game_state: isFinal ? "FINAL" : hasScore ? "LIVE" : (g.game_state ?? "FUT"),
      was_overtime: hasOT,
      scorers,
    };
  });

  return (
    <DailyTickerClient
      date={targetDate}
      games={recaps}
      isOwner={isOwner}
      teamLogos={teamLogos}
      label={label}
      leagueId={leagueId}
    />
  );
}

/** Filter games for a date + deduplicate by team matchup. */
function filterAndDedup(
  allGames: { game_id: number; away_abbrev: string | null; home_abbrev: string | null; away_score: number | null; home_score: number | null; game_state: string | null; updated_at: string; game_date?: string | null; start_time_utc?: string | null }[],
  dateISO: string,
) {
  const filtered = allGames.filter((g) => isGameOnDate(g, dateISO));

  const seen = new Map<string, typeof filtered[0]>();
  for (const g of filtered) {
    const pair = [g.away_abbrev ?? "", g.home_abbrev ?? ""].sort().join("-");
    const existing = seen.get(pair);
    if (!existing) {
      seen.set(pair, g);
    } else {
      const eHasScore = existing.away_score != null && existing.home_score != null;
      const gHasScore = g.away_score != null && g.home_score != null;
      const eFinal = existing.game_state === "FINAL";
      const gFinal = g.game_state === "FINAL";
      if (
        (!eHasScore && gHasScore) ||
        (!eFinal && gFinal) ||
        (g.updated_at > existing.updated_at)
      ) {
        seen.set(pair, g);
      }
    }
  }
  return [...seen.values()];
}

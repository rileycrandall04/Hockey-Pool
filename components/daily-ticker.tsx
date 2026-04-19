import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import type { DailyRecap } from "@/lib/types";
import { DailyTickerClient } from "./daily-ticker-client";

/**
 * Resolve today's date in Eastern time as YYYY-MM-DD.
 */
function todayEasternISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Server-side data loader for the daily scores ticker.
 *
 * Priority order:
 *   1. Today's playoff_games that have scores entered via manual stats.
 *      Shown with a "Today" label so the ticker acts as a live scoreboard.
 *   2. Most recent daily_recaps date (last night's NHL data from the cron).
 *   3. Nothing — render null if neither source has data.
 */
export async function DailyTicker({ leagueId }: { leagueId?: string } = {}) {
  const svc = createServiceClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = isAppOwner(user?.email);

  const { data: nhlTeamRows } = await svc
    .from("nhl_teams")
    .select("abbrev, logo_url");
  const teamLogos: Record<string, string> = {};
  for (const t of (nhlTeamRows ?? []) as { abbrev: string; logo_url: string | null }[]) {
    if (t.logo_url) teamLogos[t.abbrev] = t.logo_url;
  }

  // ── Try today's playoff_games first ──────────────────────────────
  const today = todayEasternISO();
  const { data: todayGames } = await svc
    .from("playoff_games")
    .select("*")
    .eq("game_date", today)
    .order("game_id", { ascending: true });

  const gamesWithScores = (todayGames ?? []).filter(
    (g: { away_score: number | null; home_score: number | null }) =>
      g.away_score != null && g.home_score != null,
  );

  if (gamesWithScores.length > 0) {
    // Fetch scorer details from manual_game_stats for these games
    const gameIds = gamesWithScores.map((g: { game_id: number }) => g.game_id);
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

    // nhl_team_id → abbrev lookup
    const teamIdToAbbrev = new Map<number, string>();
    for (const t of (nhlTeamRows ?? []) as { abbrev: string; id?: number }[]) {
      // nhl_teams may not have id in this select, fetch separately
    }
    const { data: teamIdRows } = await svc
      .from("nhl_teams")
      .select("id, abbrev");
    for (const t of teamIdRows ?? []) {
      teamIdToAbbrev.set(t.id, t.abbrev);
    }

    // Build DailyRecap-shaped objects from today's playoff_games
    const todayRecaps: DailyRecap[] = gamesWithScores.map(
      (g: {
        game_id: number;
        game_date: string;
        away_abbrev: string | null;
        home_abbrev: string | null;
        away_score: number;
        home_score: number;
        game_state: string | null;
      }) => {
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

        // Detect overtime: any player has ot_goals > 0
        const hasOT = gameStats.some(
          (s: { ot_goals: number }) => s.ot_goals > 0,
        );

        return {
          id: `live-${g.game_id}`,
          game_date: g.game_date ?? today,
          game_id: g.game_id,
          away_team_abbrev: g.away_abbrev ?? "?",
          away_team_score: g.away_score,
          home_team_abbrev: g.home_abbrev ?? "?",
          home_team_score: g.home_score,
          game_state: g.game_state ?? "LIVE",
          was_overtime: hasOT,
          scorers,
        };
      },
    );

    // Also include today's games WITHOUT scores yet (show as 0-0 scheduled)
    const allTodayRecaps = (todayGames ?? []).map(
      (g: {
        game_id: number;
        game_date: string;
        away_abbrev: string | null;
        home_abbrev: string | null;
        away_score: number | null;
        home_score: number | null;
        game_state: string | null;
      }) => {
        const existing = todayRecaps.find((r) => r.game_id === g.game_id);
        if (existing) return existing;
        return {
          id: `sched-${g.game_id}`,
          game_date: g.game_date ?? today,
          game_id: g.game_id,
          away_team_abbrev: g.away_abbrev ?? "?",
          away_team_score: g.away_score ?? 0,
          home_team_abbrev: g.home_abbrev ?? "?",
          home_team_score: g.home_score ?? 0,
          game_state: g.game_state ?? "FUT",
          was_overtime: false,
          scorers: [],
        } as DailyRecap;
      },
    );

    return (
      <DailyTickerClient
        date={today}
        games={allTodayRecaps}
        isOwner={isOwner}
        teamLogos={teamLogos}
        label="Today"
        leagueId={leagueId}
      />
    );
  }

  // ── Fall back to most recent daily_recaps ────────────────────────
  const { data: latest } = await svc
    .from("daily_recaps")
    .select("game_date")
    .order("game_date", { ascending: false })
    .limit(1);

  const date = latest?.[0]?.game_date as string | undefined;
  if (!date) return null;

  const { data: recaps } = await svc
    .from("daily_recaps")
    .select("*")
    .eq("game_date", date)
    .order("game_id", { ascending: true });

  const rows = (recaps ?? []) as DailyRecap[];
  if (rows.length === 0) return null;

  return (
    <DailyTickerClient
      date={date}
      games={rows}
      isOwner={isOwner}
      teamLogos={teamLogos}
      leagueId={leagueId}
    />
  );
}

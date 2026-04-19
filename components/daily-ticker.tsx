import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { todayEasternISO, isGameOnDate } from "@/lib/playoff-helpers";
import type { DailyRecap } from "@/lib/types";
import { DailyTickerClient } from "./daily-ticker-client";

/**
 * Server-side data loader for the daily scores ticker.
 *
 * Priority order:
 *   1. Today's playoff_games — shown whenever ANY today game has scores
 *      entered via manual stats. All today's games are included (with
 *      or without scores) so the ticker acts as a live scoreboard.
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

  // ── Find today's playoff games ─────────────────────────────────────
  const today = todayEasternISO();

  // Fetch ALL playoff_games (bracket is small), filter in JS so we
  // catch games that have game_date = null but start_time_utc today.
  const { data: allPlayoffGames } = await svc
    .from("playoff_games")
    .select("*")
    .order("game_id", { ascending: true });

  const todayGamesRaw = (allPlayoffGames ?? []).filter((g) =>
    isGameOnDate(g, today),
  );

  // Deduplicate by team matchup (keep scored/final/newest)
  const dedup = new Map<string, typeof todayGamesRaw[0]>();
  for (const g of todayGamesRaw) {
    const pair = [g.away_abbrev ?? "", g.home_abbrev ?? ""].sort().join("-");
    const key = pair;
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, g);
    } else {
      const eHasScore = existing.away_score != null && existing.home_score != null;
      const gHasScore = g.away_score != null && g.home_score != null;
      const eFinal = existing.game_state === "FINAL";
      const gFinal = g.game_state === "FINAL";
      if ((!eHasScore && gHasScore) || (!eFinal && gFinal) ||
          (g.updated_at > existing.updated_at)) {
        dedup.set(key, g);
      }
    }
  }
  const todayGames = [...dedup.values()];

  const gamesWithScores = todayGames.filter(
    (g: { away_score: number | null; home_score: number | null }) =>
      g.away_score != null && g.home_score != null,
  );

  if (gamesWithScores.length > 0) {
    // Fetch scorer details from manual_game_stats for games with scores
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

    // Build DailyRecap-shaped objects from today's games with scores
    const todayRecaps: DailyRecap[] = gamesWithScores.map(
      (g: {
        game_id: number;
        game_date: string;
        away_abbrev: string | null;
        home_abbrev: string | null;
        away_score: number;
        home_score: number;
        game_state: string | null;
        start_time_utc: string | null;
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

    // Include ALL today's games (even those without scores yet)
    const allTodayRecaps = todayGames.map(
      (g: {
        game_id: number;
        game_date: string;
        away_abbrev: string | null;
        home_abbrev: string | null;
        away_score: number | null;
        home_score: number | null;
        game_state: string | null;
        start_time_utc: string | null;
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

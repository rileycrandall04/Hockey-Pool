import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { League, PlayoffGame } from "@/lib/types";

export const dynamic = "force-dynamic";

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

interface GameWithScorers extends PlayoffGame {
  scorers: {
    player_id: number;
    name: string;
    team_abbrev: string;
    goals: number;
    assists: number;
    ot_goals: number;
  }[];
}

export default async function ScoreboardPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const league = await getLeagueForMember(supabase, leagueId, user.id);
  if (!league) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const isOwner = isAppOwner(user.email);
  const svc = createServiceClient();

  // Alert count for nav
  let alertCount = 0;
  if (isOwner) {
    const { count } = await svc
      .from("stat_conflicts")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false);
    alertCount = count ?? 0;
  }

  // Team logos
  const { data: nhlTeamRows } = await svc
    .from("nhl_teams")
    .select("id, abbrev, logo_url");
  const teamLogos: Record<string, string> = {};
  const teamIdToAbbrev = new Map<number, string>();
  for (const t of nhlTeamRows ?? []) {
    if (t.logo_url) teamLogos[t.abbrev] = t.logo_url;
    teamIdToAbbrev.set(t.id, t.abbrev);
  }

  // Fetch today's playoff games
  const today = todayEasternISO();
  const { data: todayGames } = await svc
    .from("playoff_games")
    .select("*")
    .eq("game_date", today)
    .order("game_id", { ascending: true });

  const games = (todayGames ?? []) as PlayoffGame[];

  // Fetch manual stats for all today's games
  const gameIds = games.map((g) => g.game_id);
  const { data: statRows } = gameIds.length > 0
    ? await svc
        .from("manual_game_stats")
        .select("game_id, player_id, goals, assists, ot_goals")
        .in("game_id", gameIds)
    : { data: [] };

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

  // Series context
  const seriesLetters = [...new Set(games.map((g) => g.series_letter))];
  const { data: seriesRows } = seriesLetters.length > 0
    ? await svc
        .from("playoff_series")
        .select("series_letter, round, top_seed_abbrev, bottom_seed_abbrev, top_seed_wins, bottom_seed_wins")
        .in("series_letter", seriesLetters)
    : { data: [] };
  type SeriesInfo = {
    series_letter: string;
    round: number;
    top_seed_abbrev: string | null;
    bottom_seed_abbrev: string | null;
    top_seed_wins: number;
    bottom_seed_wins: number;
  };
  const seriesMap = new Map<string, SeriesInfo>();
  for (const s of (seriesRows ?? []) as SeriesInfo[]) {
    seriesMap.set(s.series_letter, s);
  }

  // Build games with scorers
  const gamesWithScorers: GameWithScorers[] = games.map((g) => {
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
            team_abbrev: abbrev,
            goals: s.goals,
            assists: s.assists,
            ot_goals: s.ot_goals,
          };
        },
      )
      .sort(
        (
          a: { goals: number; assists: number },
          b: { goals: number; assists: number },
        ) => b.goals + b.assists - (a.goals + a.assists),
      );
    return { ...g, scorers };
  });

  const hasAnyScores = gamesWithScorers.some(
    (g) => g.away_score != null && g.home_score != null,
  );

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={league.commissioner_id === user.id}
        isOwner={isOwner}
        alertCount={alertCount}
      />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
              Scoreboard
            </h1>
            <p className="text-sm text-ice-400">
              {prettyDate(today)}
              {!hasAnyScores && games.length > 0 && " — games not started yet"}
            </p>
          </div>
          <Link
            href={`/leagues/${leagueId}/bracket`}
            className="text-sm text-ice-300 underline-offset-2 hover:text-ice-100 hover:underline"
          >
            Bracket →
          </Link>
        </div>

        {games.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-ice-400">
              No playoff games scheduled for today.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {gamesWithScorers.map((g) => {
              const ser = seriesMap.get(g.series_letter);
              const hasScore =
                g.away_score != null && g.home_score != null;
              const isFinal =
                g.game_state === "FINAL" || g.game_state === "OFF";
              const awayLogo = g.away_abbrev
                ? teamLogos[g.away_abbrev]
                : undefined;
              const homeLogo = g.home_abbrev
                ? teamLogos[g.home_abbrev]
                : undefined;

              return (
                <Card key={g.game_id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        {awayLogo && (
                          <img
                            src={awayLogo}
                            alt=""
                            className="h-7 w-7 object-contain"
                          />
                        )}
                        <span>{g.away_abbrev ?? "TBD"}</span>
                        {hasScore ? (
                          <span className="font-mono text-xl text-ice-50">
                            {g.away_score}–{g.home_score}
                          </span>
                        ) : (
                          <span className="text-ice-400">@</span>
                        )}
                        <span>{g.home_abbrev ?? "TBD"}</span>
                        {homeLogo && (
                          <img
                            src={homeLogo}
                            alt=""
                            className="h-7 w-7 object-contain"
                          />
                        )}
                        {isFinal && (
                          <span className="ml-1 rounded bg-green-500/20 px-1.5 py-0.5 text-xs font-semibold uppercase text-green-300">
                            Final
                          </span>
                        )}
                      </CardTitle>
                      {isOwner && (
                        <Link
                          href={`/games/${g.game_id}/stats?league=${leagueId}`}
                          className="text-xs font-medium text-ice-300 underline-offset-2 hover:text-ice-100 hover:underline"
                        >
                          Edit stats →
                        </Link>
                      )}
                    </div>
                    {ser && (
                      <p className="text-xs text-ice-500">
                        {ser.round ? `Round ${ser.round}` : ""}
                        {g.game_number != null
                          ? ` · Game ${g.game_number}`
                          : ""}
                        {ser.top_seed_abbrev &&
                          ser.bottom_seed_abbrev &&
                          ` · Series ${ser.top_seed_wins}-${ser.bottom_seed_wins}`}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {g.scorers.length > 0 ? (
                      <div className="space-y-1">
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-[10px] font-semibold uppercase tracking-wider text-ice-500">
                          <span>Player</span>
                          <span className="text-center">G</span>
                          <span className="text-center">A</span>
                          <span className="text-center">OTG</span>
                        </div>
                        {g.scorers.map((s) => {
                          const sLogo = teamLogos[s.team_abbrev];
                          return (
                            <div
                              key={s.player_id}
                              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 rounded px-1 py-0.5 text-sm odd:bg-puck-bg/40"
                            >
                              <span className="flex items-center gap-1.5 truncate text-ice-100">
                                {sLogo && (
                                  <img
                                    src={sLogo}
                                    alt=""
                                    className="h-4 w-4 flex-shrink-0 object-contain"
                                  />
                                )}
                                <span className="text-[10px] text-ice-500">
                                  {s.team_abbrev}
                                </span>
                                {s.name}
                              </span>
                              <span className="w-8 text-center font-mono text-ice-200">
                                {s.goals}
                              </span>
                              <span className="w-8 text-center font-mono text-ice-200">
                                {s.assists}
                              </span>
                              <span className="w-8 text-center font-mono text-ice-400">
                                {s.ot_goals || "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-ice-500">
                        {hasScore
                          ? "No individual stats entered yet."
                          : "Game has not started."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

function prettyDate(iso: string): string {
  const parsed = new Date(`${iso}T17:00:00Z`);
  if (isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parsed);
}

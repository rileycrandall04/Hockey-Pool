import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import { todayEasternISO, isGameOnDate, effectiveGameDay } from "@/lib/playoff-helpers";
import { NavBar } from "@/components/nav-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { League, PlayoffGame } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GameWithScorers extends PlayoffGame {
  scorers: {
    player_id: number;
    name: string;
    team_abbrev: string;
    goals: number;
    assists: number;
    ot_goals: number;
    owner: string | null;
  }[];
}

export default async function ScoreboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { leagueId } = await params;
  const { date: dateParam } = await searchParams;

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

  // Determine which date to show — default to the effective game day
  // (yesterday before 4:30 AM MDT, today after)
  const today = todayEasternISO();
  const { date: defaultDate } = effectiveGameDay();
  const viewDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : defaultDate;
  const isToday = viewDate === today;

  // Compute prev/next dates
  const viewDateObj = new Date(`${viewDate}T12:00:00Z`);
  const prevDate = new Date(viewDateObj);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const nextDate = new Date(viewDateObj);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const prevISO = prevDate.toISOString().slice(0, 10);
  const nextISO = nextDate.toISOString().slice(0, 10);

  // Fetch all playoff games, filter for selected date in JS (handles null game_date)
  const { data: allPlayoffGames } = await svc
    .from("playoff_games")
    .select("*")
    .order("game_id", { ascending: true });

  const todayGames = ((allPlayoffGames ?? []) as PlayoffGame[]).filter((g) =>
    isGameOnDate(g, viewDate),
  );

  // Deduplicate: if multiple rows exist for the same matchup on the
  // same day, keep the one with scores / FINAL / most recent update.
  // Key on the two team abbrevs (sorted) so order doesn't matter.
  const seen = new Map<string, PlayoffGame>();
  for (const g of todayGames) {
    const pair = [g.away_abbrev ?? "", g.home_abbrev ?? ""].sort().join("-");
    const key = `${pair}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, g);
    } else {
      // Prefer the one with scores, then FINAL state, then most recent
      const eHasScore = existing.away_score != null && existing.home_score != null;
      const gHasScore = g.away_score != null && g.home_score != null;
      const eFinal = existing.game_state === "FINAL";
      const gFinal = g.game_state === "FINAL";
      if ((!eHasScore && gHasScore) || (!eFinal && gFinal) ||
          (g.updated_at > existing.updated_at)) {
        seen.set(key, g);
      }
    }
  }
  const games = [...seen.values()].sort((a, b) => {
    const at = a.start_time_utc ? Date.parse(a.start_time_utc) : Infinity;
    const bt = b.start_time_utc ? Date.parse(b.start_time_utc) : Infinity;
    return at - bt;
  });

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

  // Player → fantasy owner lookup (draft_picks → teams → profiles)
  const playerOwnerMap = new Map<number, string>();
  if (playerIds.length > 0) {
    const { data: draftRows } = await svc
      .from("draft_picks")
      .select("player_id, team_id")
      .eq("league_id", leagueId)
      .in("player_id", playerIds);
    const fantasyTeamIds = [
      ...new Set((draftRows ?? []).map((d: { team_id: string }) => d.team_id)),
    ];
    if (fantasyTeamIds.length > 0) {
      const { data: teamOwnerRows } = await svc
        .from("teams")
        .select("id, name")
        .in("id", fantasyTeamIds);
      const teamNameMap = new Map<string, string>();
      for (const t of teamOwnerRows ?? []) {
        teamNameMap.set(t.id, t.name);
      }
      for (const d of draftRows ?? []) {
        const name = teamNameMap.get(d.team_id);
        if (name) playerOwnerMap.set(d.player_id, name);
      }
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
            owner: playerOwnerMap.get(s.player_id) ?? null,
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
            <div className="flex items-center gap-3 text-sm text-ice-400">
              <Link
                href={`/leagues/${leagueId}/scoreboard?date=${prevISO}`}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ice-300 transition-colors hover:bg-puck-border hover:text-ice-50"
                aria-label="Previous day"
              >
                ←
              </Link>
              <span>
                {prettyDate(viewDate)}
                {isToday && " (Today)"}
                {!hasAnyScores && games.length > 0 && " — games not started yet"}
              </span>
              <Link
                href={
                  nextISO === today
                    ? `/leagues/${leagueId}/scoreboard`
                    : `/leagues/${leagueId}/scoreboard?date=${nextISO}`
                }
                className="flex h-7 w-7 items-center justify-center rounded-full text-ice-300 transition-colors hover:bg-puck-border hover:text-ice-50"
                aria-label="Next day"
              >
                →
              </Link>
              {!isToday && (
                <Link
                  href={`/leagues/${leagueId}/scoreboard`}
                  className="ml-1 rounded bg-puck-border px-2 py-0.5 text-xs text-ice-300 hover:bg-puck-border/80 hover:text-ice-100"
                >
                  Today
                </Link>
              )}
            </div>
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
              No playoff games scheduled for {isToday ? "today" : prettyDate(viewDate)}.
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
                          (() => {
                            const tw = ser.top_seed_wins;
                            const bw = ser.bottom_seed_wins;
                            if (tw === 0 && bw === 0) return "";
                            const leader =
                              tw === bw ? null : tw > bw ? ser.top_seed_abbrev : ser.bottom_seed_abbrev;
                            const hi = Math.max(tw, bw);
                            const lo = Math.min(tw, bw);
                            return leader
                              ? ` · Series ${hi}-${lo} ${leader}`
                              : ` · Series tied ${tw}-${bw}`;
                          })()}
                        {!hasScore && !isFinal && g.start_time_utc && (
                          <> · {formatTimeShort(g.start_time_utc)}</>
                        )}
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
                              <span className="flex min-w-0 items-center gap-1.5 truncate text-ice-100">
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
                                <span className="truncate">
                                  {s.name}
                                  {s.owner && (
                                    <span className="ml-1 text-[10px] text-ice-600">
                                      ({s.owner})
                                    </span>
                                  )}
                                </span>
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
                        {isFinal
                          ? "No individual stats entered."
                          : hasScore
                            ? "No individual stats entered yet."
                            : g.start_time_utc
                              ? `Starts at ${formatTimeShort(g.start_time_utc)}`
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

function formatTimeShort(startTimeUtc: string): string {
  const d = new Date(startTimeUtc);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

import Link from "next/link";
import { isGameOnDate, getGameDate, effectiveGameDay } from "@/lib/playoff-helpers";
import type { PlayoffBroadcast, PlayoffGame, PlayoffSeries } from "@/lib/types";

export interface LeaguePlayer {
  player_id: number;
  name: string;
  nhl_abbrev: string;
  owner: string;
}

export interface PlayerGameStat {
  game_id: number;
  player_id: number;
  goals: number;
  assists: number;
  ot_goals: number;
}

interface TonightsGamesProps {
  games: PlayoffGame[];
  series: PlayoffSeries[];
  bracketHref: string;
  teamLogos?: Record<string, string>;
  leaguePlayers?: LeaguePlayer[];
  playerGameStats?: PlayerGameStat[];
}

/**
 * Compact "tonight's games" card for the league landing page.
 *
 * Lives directly below the league header and above the standings.
 * Intentionally small-footprint so the standings table stays the
 * visual focus of the page.
 *
 * Selection logic:
 *   1. Prefer games whose game_date is today in Eastern Time.
 *   2. If there are none, pick the next date with any scheduled
 *      games and show those with an "Upcoming" label.
 *   3. If the bracket hasn't been synced yet OR there are zero
 *      scheduled playoff games anywhere, render an empty-state
 *      placeholder so the slot is still visible on the page.
 *
 * Each row shows: AWAY @ HOME · start time (ET) · broadcast networks,
 * plus a short series context line ("Series: 2-1 TOR") when we can
 * resolve it from the series table.
 */
export function TonightsGames({
  games,
  series,
  bracketHref,
  teamLogos = {},
  leaguePlayers = [],
  playerGameStats = [],
}: TonightsGamesProps) {
  const { date: effectiveDate, isToday } = effectiveGameDay();
  const scheduledTodayRaw = (games ?? []).filter((g) => isGameOnDate(g, effectiveDate));
  const scheduledToday = deduplicateGames(scheduledTodayRaw);
  const upcomingLabel =
    scheduledToday.length > 0
      ? "Tonight"
      : pickNextDateLabel(games, effectiveDate);
  const shown =
    scheduledToday.length > 0
      ? scheduledToday
      : deduplicateGames(pickNextDateGames(games, effectiveDate));

  // Build a quick lookup so each game row can pull its parent
  // series' running score + seeded team names.
  const seriesByLetter = new Map<string, PlayoffSeries>();
  for (const s of series ?? []) seriesByLetter.set(s.series_letter, s);

  return (
    <section className="mt-4 rounded-md border border-puck-border bg-puck-card">
      <header className="flex items-center justify-between gap-2 border-b border-puck-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-ice-100 sm:text-lg">
            {upcomingLabel}
          </h2>
          {shown.length > 0 && (
            <span className="text-xs uppercase tracking-wider text-ice-500">
              {shown.length} game{shown.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <Link
          href={bracketHref}
          className="text-xs font-medium text-ice-300 underline-offset-2 hover:text-ice-100 hover:underline sm:text-sm"
        >
          Full bracket →
        </Link>
      </header>
      {shown.length === 0 ? (
        <p className="px-4 py-3 text-xs text-ice-400 sm:text-sm">
          No playoff games scheduled yet. Check back after the next
          nightly update.
        </p>
      ) : (
        <ul className="divide-y divide-puck-border/70">
          {sortGamesByStart(shown).map((g) => (
            <GameRow
              key={g.game_id}
              game={g}
              parentSeries={seriesByLetter.get(g.series_letter)}
              teamLogos={teamLogos}
              leaguePlayers={leaguePlayers}
              playerGameStats={playerGameStats}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GameRow({
  game,
  parentSeries,
  teamLogos = {},
  leaguePlayers = [],
  playerGameStats = [],
}: {
  game: PlayoffGame;
  parentSeries: PlayoffSeries | undefined;
  teamLogos?: Record<string, string>;
  leaguePlayers?: LeaguePlayer[];
  playerGameStats?: PlayerGameStat[];
}) {
  const awayLogo = game.away_abbrev ? teamLogos[game.away_abbrev] : undefined;
  const homeLogo = game.home_abbrev ? teamLogos[game.home_abbrev] : undefined;
  const time = formatGameTimeShort(game.start_time_utc);
  const networks = formatBroadcasts(game.tv_broadcasts);
  const seriesLine = formatSeriesContext(game, parentSeries);
  const hasScore = game.away_score != null && game.home_score != null;
  const isFinal = game.game_state === "FINAL" || game.game_state === "OFF";

  // Find league players in this game
  const gamePlayers = leaguePlayers.filter(
    (p) =>
      p.nhl_abbrev === game.away_abbrev ||
      p.nhl_abbrev === game.home_abbrev,
  );

  // Build stats lookup for this specific game
  const statsMap = new Map<
    number,
    { goals: number; assists: number; ot_goals: number }
  >();
  for (const s of playerGameStats) {
    if (s.game_id === game.game_id) {
      statsMap.set(s.player_id, {
        goals: s.goals,
        assists: s.assists,
        ot_goals: s.ot_goals,
      });
    }
  }

  // Sort players: those with points first (by G+A desc)
  const sortedPlayers = gamePlayers
    .map((p) => ({ ...p, stats: statsMap.get(p.player_id) ?? null }))
    .sort((a, b) => {
      const aPts = (a.stats?.goals ?? 0) + (a.stats?.assists ?? 0);
      const bPts = (b.stats?.goals ?? 0) + (b.stats?.assists ?? 0);
      return bPts - aPts;
    });

  // Short last name for compact display
  const lastName = (full: string) => {
    const parts = full.split(" ");
    return parts.length > 1 ? parts[parts.length - 1] : full;
  };

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-semibold text-ice-50">
            {awayLogo && <img src={awayLogo} alt="" className="h-5 w-5 flex-shrink-0 object-contain" />}
            {game.away_abbrev ?? "TBD"}
            {hasScore ? (
              <>
                <span className="font-mono text-ice-100">{game.away_score}</span>
                <span className="text-ice-500">&ndash;</span>
                <span className="font-mono text-ice-100">{game.home_score}</span>
              </>
            ) : (
              <span className="text-ice-400">@</span>
            )}
            {game.home_abbrev ?? "TBD"}
            {homeLogo && <img src={homeLogo} alt="" className="h-5 w-5 flex-shrink-0 object-contain" />}
            {isFinal && (
              <span className="rounded bg-green-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-green-300">
                Final
              </span>
            )}
          </span>
          {seriesLine && (
            <span className="truncate text-xs text-ice-500">
              {seriesLine}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end text-right">
          {isFinal ? (
            <span className="font-semibold text-green-300">Final</span>
          ) : hasScore ? null : (
            <>
              {time && <span className="font-mono text-ice-200">{time}</span>}
              {networks && (
                <span className="text-xs uppercase tracking-wider text-ice-400">
                  {networks}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {sortedPlayers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-1 border-t border-puck-border/40 pt-1.5 text-[11px] leading-relaxed">
          <span className="text-ice-500">My players:</span>
          {sortedPlayers.map((p, i) => {
            const parts: string[] = [];
            if (p.stats?.goals) parts.push(`${p.stats.goals}G`);
            if (p.stats?.assists) parts.push(`${p.stats.assists}A`);
            return (
              <span key={p.player_id} className="text-ice-400">
                {i > 0 && <span className="text-ice-600">,&nbsp;</span>}
                <span className={parts.length > 0 ? "text-ice-200" : ""}>
                  {lastName(p.name)}
                </span>
                {parts.length > 0 && (
                  <span className="ml-0.5 text-green-300">
                    {parts.join(" ")}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </li>
  );
}

/** Keep one row per matchup — prefer scored → FINAL → newest. */
function deduplicateGames(list: PlayoffGame[]): PlayoffGame[] {
  const seen = new Map<string, PlayoffGame>();
  for (const g of list) {
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
        ((g.updated_at ?? "") > (existing.updated_at ?? ""))
      ) {
        seen.set(pair, g);
      }
    }
  }
  return [...seen.values()];
}

function sortGamesByStart(games: PlayoffGame[]): PlayoffGame[] {
  return [...games].sort((a, b) => {
    const at = a.start_time_utc ? Date.parse(a.start_time_utc) : 0;
    const bt = b.start_time_utc ? Date.parse(b.start_time_utc) : 0;
    return at - bt;
  });
}

function pickNextDateGames(
  games: PlayoffGame[],
  todayIso: string,
): PlayoffGame[] {
  const future = (games ?? [])
    .filter((g) => {
      const d = getGameDate(g);
      return d != null && d > todayIso;
    })
    .sort((a, b) => (getGameDate(a) ?? "").localeCompare(getGameDate(b) ?? ""));
  if (future.length === 0) return [];
  const firstDate = getGameDate(future[0]!);
  return future.filter((g) => getGameDate(g) === firstDate);
}

function pickNextDateLabel(
  games: PlayoffGame[],
  todayIso: string,
): string {
  const next = pickNextDateGames(games, todayIso);
  if (next.length === 0) return "Upcoming games";
  const date = getGameDate(next[0]!);
  if (!date) return "Upcoming games";
  // Parse YYYY-MM-DD as noon ET so the weekday matches the
  // broadcast date (avoids the UTC midnight = previous day edge).
  const parsed = new Date(`${date}T17:00:00Z`);
  if (isNaN(parsed.getTime())) return "Upcoming games";
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parsed);
  return `Next games · ${short}`;
}

function formatGameTimeShort(startTimeUtc: string | null): string | null {
  if (!startTimeUtc) return null;
  const d = new Date(startTimeUtc);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

function formatBroadcasts(
  broadcasts: PlayoffBroadcast[] | null | undefined,
): string | null {
  if (!broadcasts || broadcasts.length === 0) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const b of broadcasts) {
    const key = b.network.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(b.network);
  }
  if (names.length === 0) return null;
  return names.join(", ");
}

/**
 * Short sub-line showing the parent series context: which round,
 * the two teams, and the running series score. Keeps the row dense
 * but still informative ("R1 · Series 2-1 TOR").
 */
function formatSeriesContext(
  game: PlayoffGame,
  series: PlayoffSeries | undefined,
): string | null {
  if (!series) return null;
  const parts: string[] = [];
  if (series.round) parts.push(`R${series.round}`);
  const top = series.top_seed_abbrev;
  const bottom = series.bottom_seed_abbrev;
  if (top && bottom) {
    const t = series.top_seed_wins;
    const b = series.bottom_seed_wins;
    const leader = t === b ? null : t > b ? top : bottom;
    const score = `${Math.max(t, b)}-${Math.min(t, b)}`;
    if (leader) {
      parts.push(`Series ${score} ${leader}`);
    } else if (t > 0 || b > 0) {
      parts.push(`Series tied ${t}-${b}`);
    }
  }
  if (game.game_number != null) parts.push(`Game ${game.game_number}`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

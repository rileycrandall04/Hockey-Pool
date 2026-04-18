import Link from "next/link";
import type { PlayoffBroadcast, PlayoffGame, PlayoffSeries } from "@/lib/types";

interface TonightsGamesProps {
  games: PlayoffGame[];
  series: PlayoffSeries[];
  bracketHref: string;
  teamLogos?: Record<string, string>;
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
}: TonightsGamesProps) {
  const today = todayEasternISO();
  const scheduledToday = (games ?? []).filter((g) => g.game_date === today);
  const upcomingLabel =
    scheduledToday.length > 0 ? "Tonight" : pickNextDateLabel(games, today);
  const shown =
    scheduledToday.length > 0
      ? scheduledToday
      : pickNextDateGames(games, today);

  // Build a quick lookup so each game row can pull its parent
  // series' running score + seeded team names.
  const seriesByLetter = new Map<string, PlayoffSeries>();
  for (const s of series ?? []) seriesByLetter.set(s.series_letter, s);

  return (
    <section className="mt-4 rounded-md border border-puck-border bg-puck-card">
      <header className="flex items-center justify-between gap-2 border-b border-puck-border px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ice-100">
            {upcomingLabel}
          </h2>
          {shown.length > 0 && (
            <span className="text-[10px] uppercase tracking-wider text-ice-500">
              {shown.length} game{shown.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <Link
          href={bracketHref}
          className="text-[11px] font-medium text-ice-300 underline-offset-2 hover:text-ice-100 hover:underline"
        >
          Full bracket →
        </Link>
      </header>
      {shown.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-ice-400">
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
}: {
  game: PlayoffGame;
  parentSeries: PlayoffSeries | undefined;
  teamLogos?: Record<string, string>;
}) {
  const awayLogo = game.away_abbrev ? teamLogos[game.away_abbrev] : undefined;
  const homeLogo = game.home_abbrev ? teamLogos[game.home_abbrev] : undefined;
  const time = formatGameTimeShort(game.start_time_utc);
  const networks = formatBroadcasts(game.tv_broadcasts);
  const seriesLine = formatSeriesContext(game, parentSeries);

  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 font-semibold text-ice-50">
          {awayLogo && <img src={awayLogo} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />}
          {game.away_abbrev ?? "TBD"}
          <span className="text-ice-400">@</span>
          {homeLogo && <img src={homeLogo} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />}
          {game.home_abbrev ?? "TBD"}
        </span>
        {seriesLine && (
          <span className="truncate text-[10px] text-ice-500">
            {seriesLine}
          </span>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end text-right">
        {time && <span className="font-mono text-ice-200">{time}</span>}
        {networks && (
          <span className="text-[10px] uppercase tracking-wider text-ice-400">
            {networks}
          </span>
        )}
      </div>
    </li>
  );
}

function todayEasternISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    .filter((g) => g.game_date && g.game_date > todayIso)
    .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""));
  if (future.length === 0) return [];
  const firstDate = future[0]!.game_date;
  return future.filter((g) => g.game_date === firstDate);
}

function pickNextDateLabel(
  games: PlayoffGame[],
  todayIso: string,
): string {
  const next = pickNextDateGames(games, todayIso);
  if (next.length === 0) return "Upcoming games";
  const date = next[0]!.game_date;
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

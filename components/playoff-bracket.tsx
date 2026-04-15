import type { PlayoffBroadcast, PlayoffGame, PlayoffSeries } from "@/lib/types";

interface PlayoffBracketProps {
  series: PlayoffSeries[];
  games: PlayoffGame[];
}

const ROUND_LABELS: Record<number, string> = {
  1: "First Round",
  2: "Second Round",
  3: "Conference Finals",
  4: "Stanley Cup Final",
};

/**
 * Playoff bracket card shown on each league landing page.
 *
 * Data is synced by the 6am ET cron (lib/sync-bracket.ts) and read
 * here via the props. The component is a pure server component — no
 * client-side state, no fetches.
 *
 * Layout: one collapsible <details> wrapper, then one section per
 * round (First Round, Second Round, Conference Finals, Final). Each
 * series is a compact card showing:
 *   - Team logos + abbreviations
 *   - Current series score (top_wins-bottom_wins) with the series
 *     leader highlighted.
 *   - Next game: date, time (local to the viewer via Intl), and TV
 *     broadcast networks. "Series complete" if one team has clinched.
 *
 * Renders nothing when there are zero series — e.g. during the
 * regular season or before the cron has ever run.
 */
export function PlayoffBracket({ series, games }: PlayoffBracketProps) {
  if (!series || series.length === 0) return null;

  // Group games by series letter so each series card can pick out
  // its own game list in O(1).
  const gamesBySeries = new Map<string, PlayoffGame[]>();
  for (const g of games ?? []) {
    const arr = gamesBySeries.get(g.series_letter) ?? [];
    arr.push(g);
    gamesBySeries.set(g.series_letter, arr);
  }

  // Group series by round so the UI can render section headings.
  const rounds = new Map<number, PlayoffSeries[]>();
  for (const s of series) {
    const arr = rounds.get(s.round) ?? [];
    arr.push(s);
    rounds.set(s.round, arr);
  }
  const roundKeys = [...rounds.keys()].sort((a, b) => a - b);

  return (
    <details className="group mt-4 rounded-md border border-puck-border bg-puck-card" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-puck-border/40 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 text-right text-ice-400 transition-transform group-open:rotate-90">
            ▶
          </span>
          <span className="font-semibold text-ice-100">Playoff bracket</span>
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ice-500">
          Updated nightly
        </span>
      </summary>
      <div className="space-y-4 border-t border-puck-border px-3 py-3">
        {roundKeys.map((round) => {
          const roundSeries = (rounds.get(round) ?? []).sort(
            (a, b) => a.sort_order - b.sort_order,
          );
          return (
            <section key={round}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ice-400">
                {ROUND_LABELS[round] ?? `Round ${round}`}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {roundSeries.map((s) => (
                  <SeriesCard
                    key={s.series_letter}
                    series={s}
                    games={gamesBySeries.get(s.series_letter) ?? []}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </details>
  );
}

function SeriesCard({
  series,
  games,
}: {
  series: PlayoffSeries;
  games: PlayoffGame[];
}) {
  const nextGame = pickNextGame(games);
  const topWins = series.top_seed_wins;
  const bottomWins = series.bottom_seed_wins;
  const topClinched =
    series.winning_team_abbrev != null &&
    series.winning_team_abbrev === series.top_seed_abbrev;
  const bottomClinched =
    series.winning_team_abbrev != null &&
    series.winning_team_abbrev === series.bottom_seed_abbrev;
  const seriesOver = series.winning_team_abbrev != null;

  return (
    <div className="rounded-md border border-puck-border/80 bg-puck-bg/40 p-2 text-xs">
      <div className="space-y-1">
        <TeamRow
          abbrev={series.top_seed_abbrev}
          name={series.top_seed_name}
          logo={series.top_seed_logo}
          wins={topWins}
          neededToWin={series.needed_to_win}
          winning={topWins > bottomWins}
          clinched={topClinched}
          eliminated={seriesOver && !topClinched}
        />
        <TeamRow
          abbrev={series.bottom_seed_abbrev}
          name={series.bottom_seed_name}
          logo={series.bottom_seed_logo}
          wins={bottomWins}
          neededToWin={series.needed_to_win}
          winning={bottomWins > topWins}
          clinched={bottomClinched}
          eliminated={seriesOver && !bottomClinched}
        />
      </div>
      <div className="mt-2 border-t border-puck-border/70 pt-1.5 text-[10px] text-ice-300">
        {seriesOver ? (
          <span className="text-ice-400">
            Series complete &middot;{" "}
            <span className="font-semibold text-ice-100">
              {series.winning_team_abbrev}
            </span>{" "}
            wins {Math.max(topWins, bottomWins)}–
            {Math.min(topWins, bottomWins)}
          </span>
        ) : nextGame ? (
          <NextGameLine game={nextGame} />
        ) : (
          <span className="text-ice-500">No upcoming games scheduled</span>
        )}
      </div>
    </div>
  );
}

function TeamRow({
  abbrev,
  name,
  logo,
  wins,
  neededToWin,
  winning,
  clinched,
  eliminated,
}: {
  abbrev: string | null;
  name: string | null;
  logo: string | null;
  wins: number;
  neededToWin: number;
  winning: boolean;
  clinched: boolean;
  eliminated: boolean;
}) {
  const display = abbrev ?? name ?? "TBD";
  return (
    <div
      className={
        "flex items-center justify-between gap-2 " +
        (eliminated ? "opacity-50" : "")
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="h-6 w-6 flex-shrink-0 object-contain"
          />
        ) : (
          <span className="inline-block h-6 w-6 flex-shrink-0 rounded bg-puck-border/40" />
        )}
        <span
          className={
            "truncate " +
            (clinched
              ? "font-bold text-ice-50"
              : winning
                ? "font-semibold text-ice-100"
                : "text-ice-200")
          }
        >
          {display}
        </span>
      </span>
      <span
        className={
          "flex-shrink-0 font-mono text-[11px] " +
          (wins >= neededToWin
            ? "font-bold text-green-300"
            : winning
              ? "text-ice-100"
              : "text-ice-400")
        }
      >
        {wins}
      </span>
    </div>
  );
}

function NextGameLine({ game }: { game: PlayoffGame }) {
  const when = formatGameTime(game.start_time_utc, game.game_date);
  const matchup =
    game.away_abbrev && game.home_abbrev
      ? `${game.away_abbrev} @ ${game.home_abbrev}`
      : null;
  const broadcasts = formatBroadcasts(game.tv_broadcasts);
  const gameNumLabel =
    game.game_number != null ? `Game ${game.game_number}` : "Next game";

  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="font-semibold text-ice-200">{gameNumLabel}</span>
      {matchup && (
        <>
          <span className="text-ice-500">&middot;</span>
          <span className="text-ice-300">{matchup}</span>
        </>
      )}
      {when && (
        <>
          <span className="text-ice-500">&middot;</span>
          <span className="text-ice-300">{when}</span>
        </>
      )}
      {broadcasts && (
        <>
          <span className="text-ice-500">&middot;</span>
          <span className="text-ice-400">{broadcasts}</span>
        </>
      )}
    </span>
  );
}

/**
 * Pick the "next relevant" game from a series' schedule.
 *
 * Preference order:
 *   1. First upcoming game (gameState is FUT/PRE, or start time is in
 *      the future).
 *   2. Otherwise the most recent game (LIVE / FINAL). This covers the
 *      case where a series has games scheduled but the bracket hasn't
 *      populated future rows yet.
 */
function pickNextGame(games: PlayoffGame[]): PlayoffGame | null {
  if (games.length === 0) return null;
  const sorted = [...games].sort((a, b) => {
    const at = a.start_time_utc ? Date.parse(a.start_time_utc) : 0;
    const bt = b.start_time_utc ? Date.parse(b.start_time_utc) : 0;
    return at - bt;
  });
  const now = Date.now();
  const upcoming = sorted.find((g) => {
    if (g.game_state === "FUT" || g.game_state === "PRE") return true;
    if (g.start_time_utc && Date.parse(g.start_time_utc) > now) return true;
    return false;
  });
  if (upcoming) return upcoming;
  // Return the most recent game as a fallback.
  return sorted[sorted.length - 1] ?? null;
}

/**
 * Format a game's start time for display. Prefers the full ISO
 * timestamp so we can show weekday + time in Eastern (the league's
 * canonical timezone). Falls back to just the date if startTime is
 * unavailable.
 */
function formatGameTime(
  startTimeUtc: string | null,
  gameDate: string | null,
): string | null {
  if (startTimeUtc) {
    const d = new Date(startTimeUtc);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(d);
    }
  }
  if (gameDate) {
    // gameDate is YYYY-MM-DD. Parse as noon ET so the weekday matches
    // the broadcast date (avoids the "UTC midnight = previous day in
    // ET" edge case).
    const d = new Date(`${gameDate}T17:00:00Z`);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(d);
    }
  }
  return null;
}

/**
 * Collapse the TV broadcasts array into a short, comma-separated
 * string suitable for a single line. Dedupes by network so fans in
 * different markets don't see "SN, SN, SN".
 */
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

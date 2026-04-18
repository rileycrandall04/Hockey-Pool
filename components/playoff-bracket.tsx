import type { PlayoffBroadcast, PlayoffGame, PlayoffSeries } from "@/lib/types";
import { SeriesGameEditor } from "@/components/series-game-editor";

interface PlayoffBracketProps {
  series: PlayoffSeries[];
  games: PlayoffGame[];
  isOwner?: boolean;
  leagueId?: string;
  nhlTeams?: { abbrev: string; name: string }[];
}

/**
 * Full playoff bracket shown on /leagues/[id]/bracket.
 *
 * Layout is a tree: on large screens the 15 series are laid out in
 * 7 columns that converge to the Stanley Cup Final in the middle,
 * Eastern side on the left and Western side on the right:
 *
 *   East R1  East R2  ECF  FINAL  WCF  West R2  West R1
 *   ┌────┐   ┌────┐   ┌──┐  ┌──┐  ┌──┐  ┌────┐  ┌────┐
 *   │ A  │   │    │   │  │  │  │  │  │  │    │  │ E  │
 *   ├────┤   │ I  │   │  │  │  │  │  │  │ K  │  ├────┤
 *   │ B  │   ├────┤   │M │  │O │  │N │  ├────┤  │ F  │
 *   ├────┤   │ J  │   │  │  │  │  │  │  │ L  │  ├────┤
 *   │ C  │   └────┘   └──┘  └──┘  └──┘  └────┘  │ G  │
 *   ├────┤                                      ├────┤
 *   │ D  │                                      │ H  │
 *   └────┘                                      └────┘
 *
 * Slot assignments come from the standard NHL series-letter
 * convention that's been stable since the 2020 bubble playoffs:
 *   A–D  East R1       I–J East R2    M ECF
 *   E–H  West R1       K–L West R2    N WCF   O Final
 *
 * Each column uses flex-col + justify-around so cards in the later
 * rounds naturally line up between their two feeder series without
 * any pixel math.
 *
 * On small screens (< lg) the tree collapses to a single column,
 * grouped by round headings, so it stays readable on phones.
 *
 * The component always renders the full 15-slot structure — even
 * when the database is empty — so users see the bracket shape
 * immediately. Missing series are drawn as dashed TBD placeholders.
 */

interface BracketSlot {
  letter: string;
  round: number;
  conference: "EAST" | "WEST" | "FINAL";
}

export const BRACKET_SLOTS: BracketSlot[] = [
  // East Round 1
  { letter: "A", round: 1, conference: "EAST" },
  { letter: "B", round: 1, conference: "EAST" },
  { letter: "C", round: 1, conference: "EAST" },
  { letter: "D", round: 1, conference: "EAST" },
  // West Round 1
  { letter: "E", round: 1, conference: "WEST" },
  { letter: "F", round: 1, conference: "WEST" },
  { letter: "G", round: 1, conference: "WEST" },
  { letter: "H", round: 1, conference: "WEST" },
  // East Round 2
  { letter: "I", round: 2, conference: "EAST" },
  { letter: "J", round: 2, conference: "EAST" },
  // West Round 2
  { letter: "K", round: 2, conference: "WEST" },
  { letter: "L", round: 2, conference: "WEST" },
  // Conference Finals
  { letter: "M", round: 3, conference: "EAST" },
  { letter: "N", round: 3, conference: "WEST" },
  // Stanley Cup Final
  { letter: "O", round: 4, conference: "FINAL" },
];

export function PlayoffBracket({ series, games, isOwner, leagueId, nhlTeams }: PlayoffBracketProps) {
  const seriesByLetter = new Map<string, PlayoffSeries>();
  for (const s of series ?? []) seriesByLetter.set(s.series_letter, s);

  // Group games under their parent series letter. Each series card
  // only needs its own game list for the "next game" footer.
  const gamesBySeries = new Map<string, PlayoffGame[]>();
  for (const g of games ?? []) {
    const arr = gamesBySeries.get(g.series_letter) ?? [];
    arr.push(g);
    gamesBySeries.set(g.series_letter, arr);
  }

  // Pre-build the slot groupings for both layouts (tree columns
  // and mobile stacked rounds).
  const slotsByKey = {
    eastR1: slots((s) => s.round === 1 && s.conference === "EAST"),
    eastR2: slots((s) => s.round === 2 && s.conference === "EAST"),
    ecf: slots((s) => s.round === 3 && s.conference === "EAST"),
    final: slots((s) => s.round === 4),
    wcf: slots((s) => s.round === 3 && s.conference === "WEST"),
    westR2: slots((s) => s.round === 2 && s.conference === "WEST"),
    westR1: slots((s) => s.round === 1 && s.conference === "WEST"),
  };

  const renderSlot = (slot: BracketSlot) => {
    const data = seriesByLetter.get(slot.letter);
    if (!data) return <PlaceholderSeriesCard key={slot.letter} />;

    if (isOwner && leagueId) {
      return (
        <SeriesGameEditor
          key={slot.letter}
          series={data}
          games={gamesBySeries.get(slot.letter) ?? []}
          leagueId={leagueId}
          nhlTeams={nhlTeams ?? []}
        />
      );
    }

    return (
      <div key={slot.letter}>
        <SeriesCard
          series={data}
          games={gamesBySeries.get(slot.letter) ?? []}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Desktop / tablet tree. Hidden on small screens because the
          7-column layout gets too cramped below ~1024px. */}
      <div className="hidden lg:block">
        <div className="flex items-stretch gap-3">
          <BracketColumn label="First Round" side="left">
            {slotsByKey.eastR1.map(renderSlot)}
          </BracketColumn>
          <BracketColumn label="Second Round" side="left">
            {slotsByKey.eastR2.map(renderSlot)}
          </BracketColumn>
          <BracketColumn label="Conf. Final" side="left">
            {slotsByKey.ecf.map(renderSlot)}
          </BracketColumn>
          <BracketColumn label="Stanley Cup" center>
            {slotsByKey.final.map(renderSlot)}
          </BracketColumn>
          <BracketColumn label="Conf. Final" side="right">
            {slotsByKey.wcf.map(renderSlot)}
          </BracketColumn>
          <BracketColumn label="Second Round" side="right">
            {slotsByKey.westR2.map(renderSlot)}
          </BracketColumn>
          <BracketColumn label="First Round" side="right">
            {slotsByKey.westR1.map(renderSlot)}
          </BracketColumn>
        </div>
        <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-ice-500">
          <span>&larr; Eastern Conference</span>
          <span>Western Conference &rarr;</span>
        </div>
      </div>

      {/* Mobile / narrow view: stacked groups per round. Preserves
          the information without the horizontal tree. */}
      <div className="space-y-5 lg:hidden">
        <RoundSection title="First Round · Eastern">
          {slotsByKey.eastR1.map(renderSlot)}
        </RoundSection>
        <RoundSection title="First Round · Western">
          {slotsByKey.westR1.map(renderSlot)}
        </RoundSection>
        <RoundSection title="Second Round · Eastern">
          {slotsByKey.eastR2.map(renderSlot)}
        </RoundSection>
        <RoundSection title="Second Round · Western">
          {slotsByKey.westR2.map(renderSlot)}
        </RoundSection>
        <RoundSection title="Eastern Conference Final">
          {slotsByKey.ecf.map(renderSlot)}
        </RoundSection>
        <RoundSection title="Western Conference Final">
          {slotsByKey.wcf.map(renderSlot)}
        </RoundSection>
        <RoundSection title="Stanley Cup Final">
          {slotsByKey.final.map(renderSlot)}
        </RoundSection>
      </div>
    </div>
  );
}

function slots(predicate: (s: BracketSlot) => boolean): BracketSlot[] {
  return BRACKET_SLOTS.filter(predicate);
}

function BracketColumn({
  label,
  children,
  side,
  center = false,
}: {
  label: string;
  children: React.ReactNode;
  side?: "left" | "right";
  center?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <h3
        className={
          "mb-2 text-[10px] font-semibold uppercase tracking-wider " +
          (center ? "text-center text-ice-200" : "text-center text-ice-400")
        }
      >
        {label}
      </h3>
      <div
        className={
          "flex flex-1 flex-col justify-around gap-3 " +
          (side === "right" ? "items-stretch" : "items-stretch")
        }
      >
        {children}
      </div>
    </div>
  );
}

function RoundSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ice-400">
        {title}
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function SeriesCard({
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

export function TeamRow({
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

function PlaceholderSeriesCard() {
  return (
    <div className="rounded-md border border-dashed border-puck-border/60 bg-puck-bg/30 p-2 text-xs">
      <div className="space-y-1">
        <PlaceholderTeamRow />
        <PlaceholderTeamRow />
      </div>
      <div className="mt-2 border-t border-puck-border/50 pt-1.5 text-[10px] text-ice-500">
        Awaiting data
      </div>
    </div>
  );
}

function PlaceholderTeamRow() {
  return (
    <div className="flex items-center justify-between gap-2 opacity-60">
      <span className="flex min-w-0 items-center gap-2">
        <span className="inline-block h-6 w-6 flex-shrink-0 rounded bg-puck-border/40" />
        <span className="text-ice-500">TBD</span>
      </span>
      <span className="flex-shrink-0 font-mono text-[11px] text-ice-600">
        &mdash;
      </span>
    </div>
  );
}

export function NextGameLine({ game }: { game: PlayoffGame }) {
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
export function pickNextGame(games: PlayoffGame[]): PlayoffGame | null {
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
  return sorted[sorted.length - 1] ?? null;
}

export function formatGameTime(
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

export function formatBroadcasts(
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

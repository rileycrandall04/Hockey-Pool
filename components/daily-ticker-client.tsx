"use client";

import Link from "next/link";
import { useState } from "react";
import type { DailyRecap } from "@/lib/types";

interface Props {
  date: string;
  games: DailyRecap[];
  /**
   * When true, the expanded scorers panel renders an "Edit stats →"
   * link that drops the app owner into /games/[id]/edit so they can
   * add/correct per-game manual stats. Gated at the server component
   * level so non-owners never see the link.
   */
  isOwner?: boolean;
}

/**
 * Sticky marquee ticker.
 *
 * - Sticks to `top: 0` via `sticky top-0 z-40`.
 * - Scrolls horizontally via a CSS keyframe (`animate-ticker` in
 *   globals.css). To get a seamless loop, we render the game list
 *   twice in the track and animate translateX from 0 to -50%.
 * - Tapping a game card pauses the animation (by dropping the
 *   `animate-ticker` class) and renders a scorers panel directly
 *   below the scrolling row.
 * - Tapping the same game again, the ×, or outside the ticker
 *   clears the selection and resumes scrolling.
 * - With fewer than 3 games the animation is disabled because the
 *   duplicated content wouldn't overflow the viewport meaningfully.
 */
export function DailyTickerClient({ date, games, isOwner = false }: Props) {
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const selectedGame =
    selectedGameId != null
      ? games.find((g) => g.game_id === selectedGameId) ?? null
      : null;
  const paused = selectedGame !== null;

  // Duplicate for seamless loop, but only if we actually have enough
  // content to overflow on wide screens.
  const shouldAnimate = games.length >= 3;
  const loopGames = shouldAnimate ? [...games, ...games] : games;

  const toggleSelected = (gameId: number) =>
    setSelectedGameId((prev) => (prev === gameId ? null : gameId));

  return (
    <section className="sticky top-0 z-40 border-y border-puck-border bg-puck-card/95 shadow-sm backdrop-blur">
      <div className="relative">
        <div className="flex items-center justify-between px-3 pt-1.5 text-[10px] uppercase tracking-wider text-ice-400 sm:px-4">
          <span>🏒 Last night &middot; {prettyDate(date)}</span>
          <span className="hidden text-ice-500 sm:inline">
            {paused ? "paused · tap again or × to resume" : "tap a game for scorers"}
          </span>
        </div>
        <div className="overflow-hidden pb-1.5 pt-0.5">
          <div
            className={`flex min-w-max gap-2 px-3 sm:px-4 ${
              shouldAnimate && !paused ? "animate-ticker" : ""
            }`}
          >
            {loopGames.map((g, idx) => (
              <GameChip
                key={`${g.game_id}-${idx}`}
                game={g}
                selected={selectedGameId === g.game_id}
                onClick={() => toggleSelected(g.game_id)}
              />
            ))}
          </div>
        </div>
        {selectedGame && (
          <div className="border-t border-puck-border bg-puck-bg/80 px-3 py-2 text-xs sm:px-4">
            <div className="mb-1 flex items-center justify-between">
              <div className="font-semibold text-ice-100">
                {selectedGame.away_team_abbrev}{" "}
                <span className="font-mono">
                  {selectedGame.away_team_score}–{selectedGame.home_team_score}
                </span>{" "}
                {selectedGame.home_team_abbrev}
                {selectedGame.was_overtime && (
                  <span className="ml-1 text-[10px] uppercase text-ice-400">
                    OT
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedGameId(null)}
                className="rounded px-1 text-ice-400 hover:bg-puck-border hover:text-ice-100"
                aria-label="Close scorers panel"
              >
                ×
              </button>
            </div>
            {selectedGame.scorers.length > 0 ? (
              <ul className="grid gap-x-4 gap-y-0.5 text-ice-300 sm:grid-cols-2">
                {selectedGame.scorers.map((s) => (
                  <li
                    key={s.player_id}
                    className="flex justify-between gap-2"
                  >
                    <span className="truncate">
                      <span className="text-[10px] text-ice-500">
                        {s.team}
                      </span>{" "}
                      {s.name}
                    </span>
                    <span className="flex-shrink-0 text-ice-400">
                      {s.goals > 0 && `${s.goals}G`}
                      {s.goals > 0 && s.assists > 0 && " "}
                      {s.assists > 0 && `${s.assists}A`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ice-500">No scoring summary for this game.</p>
            )}
            {isOwner && (
              <div className="mt-2 flex justify-end">
                <Link
                  href={`/games/${selectedGame.game_id}/edit`}
                  className="text-[11px] font-medium text-ice-300 underline-offset-2 hover:text-ice-100 hover:underline"
                >
                  Edit stats →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function GameChip({
  game,
  selected,
  onClick,
}: {
  game: DailyRecap;
  selected: boolean;
  onClick: () => void;
}) {
  const awayWon = game.away_team_score > game.home_team_score;
  const homeWon = game.home_team_score > game.away_team_score;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition sm:gap-2 sm:px-2.5 sm:text-xs ${
        selected
          ? "border-ice-400 bg-ice-500/25 text-ice-50"
          : "border-puck-border bg-puck-bg text-ice-200 hover:bg-puck-border/60"
      }`}
    >
      <span className={awayWon ? "font-semibold" : "text-ice-400"}>
        {game.away_team_abbrev}
      </span>
      <span className="font-mono text-ice-100">
        {game.away_team_score}–{game.home_team_score}
      </span>
      <span className={homeWon ? "font-semibold" : "text-ice-400"}>
        {game.home_team_abbrev}
      </span>
      {game.was_overtime && (
        <span className="text-[9px] uppercase text-ice-400">OT</span>
      )}
    </button>
  );
}

function prettyDate(iso: string): string {
  const [, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[(m ?? 1) - 1]} ${d ?? 1}`;
}

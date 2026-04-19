"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DailyRecap } from "@/lib/types";

interface Props {
  date: string;
  games: DailyRecap[];
  isOwner?: boolean;
  teamLogos?: Record<string, string>;
  label?: string;
  leagueId?: string;
}

/**
 * Sticky ticker bar showing game chips.
 *
 * Only auto-scrolls when the chips overflow the container width.
 * When they fit, they sit static and centered. Tapping a chip
 * opens a scorers panel below.
 */
export function DailyTickerClient({ date, games, isOwner = false, teamLogos = {}, label, leagueId }: Props) {
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const selectedGame =
    selectedGameId != null
      ? games.find((g) => g.game_id === selectedGameId) ?? null
      : null;
  const paused = selectedGame !== null;

  // Measure whether the chips overflow the container
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    function check() {
      if (!containerRef.current || !trackRef.current) return;
      setOverflows(trackRef.current.scrollWidth > containerRef.current.clientWidth);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [games.length]);

  // For seamless loop animation we need to duplicate the list,
  // but ONLY when overflowing and animating.
  const shouldAnimate = overflows && !paused;
  const displayGames = shouldAnimate ? [...games, ...games] : games;

  const toggleSelected = (gameId: number) =>
    setSelectedGameId((prev) => (prev === gameId ? null : gameId));

  return (
    <section className="sticky top-0 z-40 border-y border-puck-border bg-puck-card/95 shadow-sm backdrop-blur">
      <div className="relative">
        <div className="flex items-center justify-between px-3 pt-1.5 text-[10px] uppercase tracking-wider text-ice-400 sm:px-4">
          <span>🏒 {label ?? "Last night"} &middot; {prettyDate(date)}</span>
          <span className="flex items-center gap-2">
            {paused && (
              <span className="hidden text-ice-500 sm:inline">
                tap again or × to close
              </span>
            )}
            {leagueId && (
              <Link
                href={`/leagues/${leagueId}/scoreboard`}
                className="text-ice-300 underline-offset-2 hover:text-ice-100 hover:underline"
              >
                Scoreboard →
              </Link>
            )}
          </span>
        </div>
        <div ref={containerRef} className="overflow-hidden pb-1.5 pt-0.5">
          <div
            ref={trackRef}
            className={`flex min-w-max gap-2 px-3 sm:px-4 ${
              shouldAnimate ? "animate-ticker" : ""
            }`}
          >
            {displayGames.map((g, idx) => (
              <GameChip
                key={`${g.game_id}-${idx}`}
                game={g}
                selected={selectedGameId === g.game_id}
                onClick={() => toggleSelected(g.game_id)}
                teamLogos={teamLogos}
              />
            ))}
          </div>
        </div>
        {selectedGame && (
          <div className="border-t border-puck-border bg-puck-bg/80 px-3 py-2 text-xs sm:px-4">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-ice-100">
                {teamLogos[selectedGame.away_team_abbrev] && (
                  <img src={teamLogos[selectedGame.away_team_abbrev]} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                )}
                {selectedGame.away_team_abbrev}{" "}
                <span className="font-mono">
                  {selectedGame.away_team_score}–{selectedGame.home_team_score}
                </span>{" "}
                {selectedGame.home_team_abbrev}
                {teamLogos[selectedGame.home_team_abbrev] && (
                  <img src={teamLogos[selectedGame.home_team_abbrev]} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                )}
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
                    <span className="flex min-w-0 items-center gap-1 truncate">
                      {teamLogos[s.team] && (
                        <img src={teamLogos[s.team]} alt="" className="h-3.5 w-3.5 flex-shrink-0 object-contain" />
                      )}
                      <span className="text-[10px] text-ice-500">
                        {s.team}
                      </span>
                      <span className="truncate">{s.name}</span>
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
                  href={`/games/${selectedGame.game_id}/stats`}
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
  teamLogos = {},
}: {
  game: DailyRecap;
  selected: boolean;
  onClick: () => void;
  teamLogos?: Record<string, string>;
}) {
  const hasScore = game.game_state !== "FUT" && (game.away_team_score > 0 || game.home_team_score > 0);
  const isFinal = game.game_state === "FINAL" || game.game_state === "OFF";
  const awayWon = game.away_team_score > game.home_team_score;
  const homeWon = game.home_team_score > game.away_team_score;
  const awayLogo = teamLogos[game.away_team_abbrev];
  const homeLogo = teamLogos[game.home_team_abbrev];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-shrink-0 items-center gap-2 rounded border px-3 py-1.5 text-sm transition sm:gap-2.5 sm:px-4 sm:text-base ${
        selected
          ? "border-ice-400 bg-ice-500/25 text-ice-50"
          : "border-puck-border bg-puck-bg text-ice-200 hover:bg-puck-border/60"
      }`}
    >
      {awayLogo && <img src={awayLogo} alt="" className="h-6 w-6 flex-shrink-0 object-contain" />}
      <span className={hasScore && awayWon ? "font-semibold" : "text-ice-400"}>
        {game.away_team_abbrev}
      </span>
      {hasScore ? (
        <span className="font-mono text-ice-100">
          {game.away_team_score}–{game.home_team_score}
        </span>
      ) : (
        <span className="text-ice-500">@</span>
      )}
      <span className={hasScore && homeWon ? "font-semibold" : "text-ice-400"}>
        {game.home_team_abbrev}
      </span>
      {homeLogo && <img src={homeLogo} alt="" className="h-6 w-6 flex-shrink-0 object-contain" />}
      {hasScore && game.was_overtime && (
        <span className="text-xs uppercase text-ice-400">OT</span>
      )}
      {isFinal && (
        <span className="rounded bg-green-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-green-300">
          Final
        </span>
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

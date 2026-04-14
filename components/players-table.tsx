"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { InjuryBadge } from "@/components/injury-badge";
import type { Position } from "@/lib/types";

export interface PlayersTableRow {
  id: number;
  full_name: string;
  position: Position;
  team_abbrev: string | null;
  season_goals: number;
  season_assists: number;
  season_points: number;
  season_games_played: number;
  playoff_points: number;
  injury_status: string | null;
  injury_description: string | null;
}

interface Props {
  players: PlayersTableRow[];
}

/**
 * Live-filtering players table. Takes the full player pool as props
 * from a server component and does all filtering client-side on each
 * keystroke + position-pill tap. No form submit, no extra network
 * round-trip, no separate Filter button.
 *
 * Layout is mobile-first: base text-[11px] with tight padding and a
 * truncated player name column that eats whatever horizontal space
 * is left. On sm+ screens the text scales up and the GP column is
 * shown (hidden on phones to save width).
 */
export function PlayersTable({ players }: Props) {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      if (position !== "ALL") {
        if (position === "F") {
          if (
            p.position !== "C" &&
            p.position !== "L" &&
            p.position !== "R" &&
            p.position !== "F"
          ) {
            return false;
          }
        } else if (p.position !== position) {
          return false;
        }
      }
      if (q.length === 0) return true;
      if (p.full_name.toLowerCase().includes(q)) return true;
      if (p.team_abbrev?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [players, search, position]);

  const positions: Array<Position | "ALL"> = [
    "ALL",
    "C",
    "L",
    "R",
    "D",
    "G",
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          inputMode="search"
          placeholder="Search name or team..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50 placeholder:text-ice-400 focus:outline-none focus:ring-2 focus:ring-ice-500"
        />
        <div className="flex gap-1">
          {positions.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPosition(p)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                position === p
                  ? "bg-ice-500 text-white"
                  : "bg-puck-border text-ice-200 hover:bg-ice-800"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 text-[10px] uppercase tracking-wider text-ice-500">
        {filtered.length} player{filtered.length === 1 ? "" : "s"}
      </div>

      <div className="overflow-hidden rounded-md border border-puck-border">
        <table className="w-full table-fixed text-[11px] sm:text-sm">
          <colgroup>
            <col />
            <col className="w-[28px] sm:w-[40px]" />
            <col className="w-[32px] sm:w-[44px]" />
            <col className="hidden w-[32px] sm:table-column" />
            <col className="w-[28px] sm:w-[36px]" />
            <col className="w-[28px] sm:w-[36px]" />
            <col className="w-[34px] sm:w-[44px]" />
            <col className="w-[32px] sm:w-[40px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-puck-border text-left text-ice-400">
              <th className="px-1.5 py-1.5 sm:px-2 sm:py-2">Player</th>
              <th className="px-1 py-1.5 sm:px-2 sm:py-2">Pos</th>
              <th className="px-1 py-1.5 sm:px-2 sm:py-2">Tm</th>
              <th className="hidden px-1 py-1.5 text-right sm:table-cell sm:px-2 sm:py-2">
                GP
              </th>
              <th className="px-1 py-1.5 text-right sm:px-2 sm:py-2">G</th>
              <th className="px-1 py-1.5 text-right sm:px-2 sm:py-2">A</th>
              <th className="px-1 py-1.5 text-right sm:px-2 sm:py-2">PTS</th>
              <th className="px-1 py-1.5 text-right sm:px-2 sm:py-2">PO</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-2 py-6 text-center text-ice-400"
                >
                  No players match your filters.
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr
                key={p.id}
                className="border-b border-puck-border last:border-0"
              >
                <td className="px-1.5 py-1.5 font-medium text-ice-100 sm:px-2">
                  <Link
                    href={`/players/${p.id}`}
                    className="flex min-w-0 items-center hover:underline"
                  >
                    <span className="truncate">{p.full_name}</span>
                    <InjuryBadge
                      status={p.injury_status}
                      description={p.injury_description}
                    />
                  </Link>
                </td>
                <td className="px-1 py-1.5 text-ice-300 sm:px-2">
                  {p.position}
                </td>
                <td className="px-1 py-1.5 text-ice-300 sm:px-2">
                  {p.team_abbrev ?? "—"}
                </td>
                <td className="hidden px-1 py-1.5 text-right text-ice-300 sm:table-cell sm:px-2">
                  {p.season_games_played}
                </td>
                <td className="px-1 py-1.5 text-right text-ice-300 sm:px-2">
                  {p.season_goals}
                </td>
                <td className="px-1 py-1.5 text-right text-ice-300 sm:px-2">
                  {p.season_assists}
                </td>
                <td className="px-1 py-1.5 text-right font-semibold text-ice-50 sm:px-2">
                  {p.season_points}
                </td>
                <td className="px-1 py-1.5 text-right text-ice-300 sm:px-2">
                  {p.playoff_points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

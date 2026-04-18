"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { ManualGameStat } from "@/lib/types";

interface PlayerInfo {
  id: number;
  full_name: string;
  position: string;
}

interface TeamInfo {
  abbrev: string;
  name: string;
  players: PlayerInfo[];
}

interface GameStatsEditorProps {
  gameId: number;
  awayTeam: TeamInfo;
  homeTeam: TeamInfo;
  existingStats: ManualGameStat[];
  upsertAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
}

const POS_ORDER: Record<string, number> = {
  C: 0,
  L: 1,
  R: 2,
  F: 3,
  D: 4,
  G: 5,
};

function sortPlayers(
  players: PlayerInfo[],
  statsMap: Map<number, ManualGameStat>,
): PlayerInfo[] {
  return [...players].sort((a, b) => {
    // Players with stats float to the top
    const aHas = statsMap.has(a.id) ? 0 : 1;
    const bHas = statsMap.has(b.id) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    // Within each group, sort by position then name
    const pa = POS_ORDER[a.position] ?? 9;
    const pb = POS_ORDER[b.position] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.full_name.localeCompare(b.full_name);
  });
}

const POS_COLORS: Record<string, string> = {
  C: "bg-blue-500/20 text-blue-300",
  L: "bg-green-500/20 text-green-300",
  R: "bg-emerald-500/20 text-emerald-300",
  F: "bg-teal-500/20 text-teal-300",
  D: "bg-orange-500/20 text-orange-300",
  G: "bg-purple-500/20 text-purple-300",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

export function GameStatsEditor({
  gameId,
  awayTeam,
  homeTeam,
  existingStats,
  upsertAction,
  deleteAction,
}: GameStatsEditorProps) {
  const [activeTeam, setActiveTeam] = useState<"away" | "home">("away");

  const statsByPlayerId = new Map<number, ManualGameStat>();
  for (const s of existingStats) statsByPlayerId.set(s.player_id, s);

  const team = activeTeam === "away" ? awayTeam : homeTeam;
  const sorted = sortPlayers(team.players, statsByPlayerId);

  // Count entries per team + find the most recent update
  const awayIds = new Set(awayTeam.players.map((p) => p.id));
  const homeIds = new Set(homeTeam.players.map((p) => p.id));
  let awayCount = 0;
  let homeCount = 0;
  let latestUpdate: string | null = null;
  for (const s of existingStats) {
    if (awayIds.has(s.player_id)) awayCount++;
    if (homeIds.has(s.player_id)) homeCount++;
    if (!latestUpdate || s.updated_at > latestUpdate) {
      latestUpdate = s.updated_at;
    }
  }

  return (
    <div className="space-y-4">
      {/* Last-updated summary */}
      {latestUpdate && (
        <div className="flex items-center gap-2 text-[10px] text-ice-500">
          <span>
            Last updated: {timeAgo(latestUpdate)}
          </span>
          <span className="text-ice-600">
            ({new Date(latestUpdate).toLocaleString("en-US", {
              timeZone: "America/Denver",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })} MDT)
          </span>
        </div>
      )}

      {/* Team toggle */}
      <div className="flex rounded-md border border-puck-border overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveTeam("away")}
          className={
            "flex-1 px-3 py-2 text-sm font-semibold transition " +
            (activeTeam === "away"
              ? "bg-ice-500 text-white"
              : "bg-puck-bg text-ice-300 hover:bg-puck-card")
          }
        >
          {awayTeam.abbrev}
          <span className="ml-1 text-[10px] font-normal opacity-70">
            {awayCount > 0
              ? `${awayCount} entered`
              : `${awayTeam.players.length} players`}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTeam("home")}
          className={
            "flex-1 px-3 py-2 text-sm font-semibold transition " +
            (activeTeam === "home"
              ? "bg-ice-500 text-white"
              : "bg-puck-bg text-ice-300 hover:bg-puck-card")
          }
        >
          {homeTeam.abbrev}
          <span className="ml-1 text-[10px] font-normal opacity-70">
            {homeCount > 0
              ? `${homeCount} entered`
              : `${homeTeam.players.length} players`}
          </span>
        </button>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_auto] items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-ice-400">
        <span>Player</span>
        <span className="text-center">G</span>
        <span className="text-center">A</span>
        <span className="text-center">OT</span>
        <span></span>
      </div>

      {/* Player rows */}
      {sorted.length === 0 ? (
        <p className="px-2 text-xs text-ice-500">
          No players loaded for {team.abbrev}.
        </p>
      ) : (
        <div className="space-y-1">
          {sorted.map((player) => {
            const existing = statsByPlayerId.get(player.id);
            const hasStats = existing != null;
            return (
              <PlayerStatRow
                key={player.id}
                player={player}
                gameId={gameId}
                existing={existing}
                hasStats={hasStats}
                upsertAction={upsertAction}
                deleteAction={deleteAction}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlayerStatRow({
  player,
  gameId,
  existing,
  hasStats,
  upsertAction,
  deleteAction,
}: {
  player: PlayerInfo;
  gameId: number;
  existing: ManualGameStat | undefined;
  hasStats: boolean;
  upsertAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const posColor = POS_COLORS[player.position] ?? "bg-puck-border/40 text-ice-400";

  return (
    <div
      className={
        "rounded-md border px-2 py-1.5 " +
        (hasStats
          ? "border-ice-500/30 bg-ice-500/5"
          : "border-puck-border/50 bg-puck-bg/40")
      }
    >
      <form
        action={upsertAction}
        className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem_auto] items-center gap-1.5"
      >
        <input type="hidden" name="game_id" value={gameId} />
        <input type="hidden" name="player_id" value={player.id} />

        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={
              "inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[9px] font-bold " +
              posColor
            }
          >
            {player.position}
          </span>
          <div className="min-w-0">
            <span className="block truncate text-xs text-ice-100">
              {player.full_name}
            </span>
            {hasStats && existing && (
              <span className="block text-[9px] text-ice-500">
                Saved: {existing.goals}G {existing.assists}A{" "}
                {existing.ot_goals}OT
                {existing.updated_at && (
                  <> &middot; {timeAgo(existing.updated_at)}</>
                )}
              </span>
            )}
          </div>
        </div>

        <Input
          name="goals"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          defaultValue={existing?.goals ?? 0}
          className="h-7 px-1 text-center text-xs"
        />
        <Input
          name="assists"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          defaultValue={existing?.assists ?? 0}
          className="h-7 px-1 text-center text-xs"
        />
        <Input
          name="ot_goals"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          defaultValue={existing?.ot_goals ?? 0}
          className="h-7 px-1 text-center text-xs"
        />

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            type="submit"
            className="h-7 px-2 text-[10px]"
          >
            Save
          </Button>
          {hasStats && (
            <form action={deleteAction} className="inline">
              <input type="hidden" name="game_id" value={gameId} />
              <input type="hidden" name="player_id" value={player.id} />
              <button
                type="submit"
                className="h-7 px-1 text-[10px] text-red-400 hover:text-red-300"
                title="Remove entry"
              >
                &times;
              </button>
            </form>
          )}
        </div>
      </form>
    </div>
  );
}

"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface PlayerEdits {
  goals: number;
  assists: number;
  ot_goals: number;
}

interface GameStatsEditorProps {
  gameId: number;
  awayTeam: TeamInfo;
  homeTeam: TeamInfo;
  existingStats: ManualGameStat[];
  batchUpsertAction: (formData: FormData) => Promise<void>;
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
    const aHas = statsMap.has(a.id) ? 0 : 1;
    const bHas = statsMap.has(b.id) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
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
  batchUpsertAction,
  deleteAction,
}: GameStatsEditorProps) {
  const [activeTeam, setActiveTeam] = useState<"away" | "home">("away");

  // Track all edits across both teams in a single map
  const [edits, setEdits] = useState<Map<number, PlayerEdits>>(() => {
    const m = new Map<number, PlayerEdits>();
    for (const s of existingStats) {
      m.set(s.player_id, {
        goals: s.goals,
        assists: s.assists,
        ot_goals: s.ot_goals,
      });
    }
    return m;
  });

  const formRef = useRef<HTMLFormElement>(null);

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

  // Count how many players have pending changes vs their saved row.
  // An edit counts as dirty if the values differ from what's already
  // saved — including dropping a previously-saved stat back to zero,
  // which is how the user undoes an accidental goal.
  let dirtyCount = 0;
  for (const [playerId, v] of edits) {
    const prev = statsByPlayerId.get(playerId);
    const prevG = prev?.goals ?? 0;
    const prevA = prev?.assists ?? 0;
    const prevOt = prev?.ot_goals ?? 0;
    if (v.goals !== prevG || v.assists !== prevA || v.ot_goals !== prevOt) {
      dirtyCount++;
    }
  }

  function updateField(
    playerId: number,
    field: keyof PlayerEdits,
    value: number,
  ) {
    setEdits((prev) => {
      const next = new Map(prev);
      const cur = next.get(playerId) ?? { goals: 0, assists: 0, ot_goals: 0 };
      next.set(playerId, { ...cur, [field]: value });
      return next;
    });
  }

  function handleSubmit() {
    if (!formRef.current) return;
    // Build the entries JSON from current edits. Include zero-valued
    // entries when the player has a previously-saved row so the server
    // can delete it (fixes undoing an accidental goal via text edit).
    const entries: { player_id: number; goals: number; assists: number; ot_goals: number }[] = [];
    for (const [playerId, vals] of edits) {
      const hadPrev = statsByPlayerId.has(playerId);
      const isZero = vals.goals === 0 && vals.assists === 0 && vals.ot_goals === 0;
      if (isZero && !hadPrev) continue;
      entries.push({ player_id: playerId, ...vals });
    }
    // Set the hidden field and submit
    const entriesInput = formRef.current.querySelector<HTMLInputElement>(
      'input[name="entries"]',
    );
    if (entriesInput) entriesInput.value = JSON.stringify(entries);
    formRef.current.requestSubmit();
  }

  return (
    <div className="space-y-4">
      {/* Last-updated summary */}
      {latestUpdate && (
        <div className="flex items-center gap-2 text-[10px] text-ice-500">
          <span>Last updated: {timeAgo(latestUpdate)}</span>
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

      {/* Player rows */}
      {sorted.length === 0 ? (
        <p className="px-2 text-xs text-ice-500">
          No players loaded for {team.abbrev}.
        </p>
      ) : (
        <div className="space-y-1">
          {sorted.map((player) => {
            const existing = statsByPlayerId.get(player.id);
            const vals = edits.get(player.id) ?? {
              goals: 0,
              assists: 0,
              ot_goals: 0,
            };
            const hasStats = existing != null;
            const posColor =
              POS_COLORS[player.position] ?? "bg-puck-border/40 text-ice-400";

            return (
              <div
                key={player.id}
                className={
                  "rounded-md border px-2 py-2 " +
                  (hasStats
                    ? "border-ice-500/30 bg-ice-500/5"
                    : "border-puck-border/50 bg-puck-bg/40")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      className={
                        "inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[9px] font-bold " +
                        posColor
                      }
                    >
                      {player.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-xs text-ice-100">
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
                  {hasStats && (
                    <form action={deleteAction} className="flex-shrink-0">
                      <input type="hidden" name="game_id" value={gameId} />
                      <input
                        type="hidden"
                        name="player_id"
                        value={player.id}
                      />
                      <button
                        type="submit"
                        className="h-7 px-1.5 text-[10px] text-red-400 hover:text-red-300"
                        title="Remove entry"
                      >
                        &times;
                      </button>
                    </form>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatControl
                    label="G"
                    value={vals.goals}
                    onSet={(v) => updateField(player.id, "goals", v)}
                  />
                  <StatControl
                    label="A"
                    value={vals.assists}
                    onSet={(v) => updateField(player.id, "assists", v)}
                  />
                  <StatControl
                    label="OT"
                    value={vals.ot_goals}
                    onSet={(v) => updateField(player.id, "ot_goals", v)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Single save button */}
      <form ref={formRef} action={batchUpsertAction}>
        <input type="hidden" name="game_id" value={gameId} />
        <input type="hidden" name="entries" value="[]" />
      </form>
      <div className="sticky bottom-4 flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={dirtyCount === 0}
          className="shadow-lg"
        >
          Save all ({dirtyCount} player{dirtyCount === 1 ? "" : "s"})
        </Button>
      </div>
    </div>
  );
}

function StatControl({
  label,
  value,
  onSet,
}: {
  label: string;
  value: number;
  onSet: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-6 text-[10px] font-semibold uppercase tracking-wider text-ice-400">
        {label}
      </span>
      <Input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value === 0 ? "" : value}
        onChange={(e) =>
          onSet(Math.max(0, parseInt(e.target.value) || 0))
        }
        className="h-8 w-12 px-1 text-center text-sm"
      />
      <button
        type="button"
        onClick={() => onSet(value + 1)}
        aria-label={`Add 1 ${label}`}
        className="h-8 w-8 rounded border border-ice-500/40 bg-ice-500/10 text-base font-bold text-ice-100 hover:bg-ice-500/30"
      >
        +
      </button>
    </div>
  );
}

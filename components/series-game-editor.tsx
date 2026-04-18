"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlayoffGame, PlayoffSeries } from "@/lib/types";
import { SeriesCard } from "@/components/playoff-bracket";
import {
  createGameAction,
  updateGameAction,
  deleteGameAction,
} from "@/app/leagues/[leagueId]/bracket/actions";
import { utcToMdtLocal } from "@/app/leagues/[leagueId]/bracket/time-helpers";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

interface SeriesGameEditorProps {
  series: PlayoffSeries;
  games: PlayoffGame[];
  leagueId: string;
  nhlTeams: { abbrev: string; name: string }[];
}

const GAME_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;

export function SeriesGameEditor({
  series,
  games,
  leagueId,
  nhlTeams,
}: SeriesGameEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [addingSlot, setAddingSlot] = useState<number | null>(null);

  const gameByNumber = new Map<number, PlayoffGame>();
  for (const g of games) {
    if (g.game_number != null) gameByNumber.set(g.game_number, g);
  }

  return (
    <div>
      {/* Clickable series card header */}
      <button
        type="button"
        onClick={() => {
          setExpanded(!expanded);
          setEditingSlot(null);
          setAddingSlot(null);
        }}
        className={
          "block w-full rounded-md text-left transition " +
          (expanded
            ? "ring-2 ring-ice-400/50"
            : "hover:ring-2 hover:ring-ice-400/50")
        }
      >
        <SeriesCard series={series} games={games} />
      </button>

      {/* Expanded game slot panel */}
      {expanded && (
        <div className="mt-1 rounded-b-md border border-t-0 border-puck-border/60 bg-puck-bg/60 p-2 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ice-400">
              Games &middot; Series {series.series_letter}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[10px] text-ice-500 hover:text-ice-300"
            >
              Close
            </button>
          </div>

          {GAME_SLOTS.map((num) => {
            const game = gameByNumber.get(num);
            if (game) {
              return (
                <FilledGameSlot
                  key={num}
                  game={game}
                  gameNumber={num}
                  leagueId={leagueId}
                  isEditing={editingSlot === num}
                  onToggleEdit={() =>
                    setEditingSlot(editingSlot === num ? null : num)
                  }
                />
              );
            }
            return (
              <EmptyGameSlot
                key={num}
                gameNumber={num}
                series={series}
                leagueId={leagueId}
                nhlTeams={nhlTeams}
                isAdding={addingSlot === num}
                onToggleAdd={() =>
                  setAddingSlot(addingSlot === num ? null : num)
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filled game slot                                                    */
/* ------------------------------------------------------------------ */

function FilledGameSlot({
  game,
  gameNumber,
  leagueId,
  isEditing,
  onToggleEdit,
}: {
  game: PlayoffGame;
  gameNumber: number;
  leagueId: string;
  isEditing: boolean;
  onToggleEdit: () => void;
}) {
  const when = game.start_time_utc
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Denver",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(game.start_time_utc))
    : game.game_date ?? "";

  const stateBadge = game.game_state ?? "FUT";
  const isFinal = stateBadge === "FINAL";
  const score =
    game.away_score != null && game.home_score != null
      ? `${game.away_score}–${game.home_score}`
      : null;

  return (
    <div className="rounded border border-puck-border/50 bg-puck-card/40 p-1.5 text-[11px]">
      {/* Summary row */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono font-bold text-ice-200">G{gameNumber}</span>
          <span
            className={
              "rounded px-1 py-0.5 text-[9px] font-semibold uppercase " +
              (isFinal
                ? "bg-green-500/20 text-green-300"
                : stateBadge === "LIVE"
                  ? "bg-red-500/20 text-red-300"
                  : "bg-puck-border/40 text-ice-400")
            }
          >
            {stateBadge}
          </span>
          {when && <span className="text-ice-400 truncate">{when}</span>}
          {game.away_abbrev && game.home_abbrev && (
            <span className="text-ice-300">
              {game.away_abbrev} @ {game.home_abbrev}
            </span>
          )}
          {score && (
            <span className="font-bold text-ice-100">{score}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Link
            href={`/games/${game.game_id}/stats?from=bracket&league=${leagueId}`}
            className="rounded px-1.5 py-0.5 text-[9px] font-medium text-ice-400 hover:bg-puck-border/40 hover:text-ice-200"
          >
            Stats
          </Link>
          <button
            type="button"
            onClick={onToggleEdit}
            className="rounded px-1.5 py-0.5 text-[9px] font-medium text-ice-400 hover:bg-puck-border/40 hover:text-ice-200"
          >
            {isEditing ? "Cancel" : "Edit"}
          </button>
        </div>
      </div>

      {/* Inline edit form */}
      {isEditing && (
        <form
          action={updateGameAction}
          className="mt-2 space-y-2 border-t border-puck-border/40 pt-2"
        >
          <input type="hidden" name="league_id" value={leagueId} />
          <input type="hidden" name="game_id" value={game.game_id} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="space-y-0.5">
              <Label className="text-[9px]">Start (MDT)</Label>
              <Input
                name="start_time_utc"
                type="datetime-local"
                defaultValue={
                  game.start_time_utc
                    ? utcToMdtLocal(game.start_time_utc)
                    : ""
                }
                className="text-[11px] h-7 px-1.5"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px]">Venue</Label>
              <Input
                name="venue"
                defaultValue={game.venue ?? ""}
                className="text-[11px] h-7 px-1.5"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px]">State</Label>
              <Select
                name="game_state"
                defaultValue={game.game_state ?? "FUT"}
                className="text-[11px] h-7 px-1.5"
              >
                <option value="FUT">FUT</option>
                <option value="PRE">PRE</option>
                <option value="LIVE">LIVE</option>
                <option value="FINAL">FINAL</option>
                <option value="OFF">OFF</option>
              </Select>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px]">Away</Label>
              <Input
                name="away_score"
                type="number"
                min={0}
                defaultValue={game.away_score ?? ""}
                className="text-[11px] h-7 px-1.5"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px]">Home</Label>
              <Input
                name="home_score"
                type="number"
                min={0}
                defaultValue={game.home_score ?? ""}
                className="text-[11px] h-7 px-1.5"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" type="submit" className="h-6 px-2 text-[10px]">
              Save
            </Button>
            <form action={deleteGameAction} className="inline">
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="game_id" value={game.game_id} />
              <Button
                size="sm"
                variant="danger"
                type="submit"
                className="h-6 px-2 text-[10px]"
              >
                Delete
              </Button>
            </form>
          </div>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty game slot                                                     */
/* ------------------------------------------------------------------ */

function EmptyGameSlot({
  gameNumber,
  series,
  leagueId,
  nhlTeams,
  isAdding,
  onToggleAdd,
}: {
  gameNumber: number;
  series: PlayoffSeries;
  leagueId: string;
  nhlTeams: { abbrev: string; name: string }[];
  isAdding: boolean;
  onToggleAdd: () => void;
}) {
  return (
    <div className="rounded border border-dashed border-puck-border/40 bg-puck-bg/30 p-1.5 text-[11px]">
      {!isAdding ? (
        <button
          type="button"
          onClick={onToggleAdd}
          className="flex w-full items-center justify-center gap-1 py-0.5 text-ice-500 hover:text-ice-300"
        >
          <span className="font-mono font-bold">G{gameNumber}</span>
          <span className="text-lg leading-none">+</span>
        </button>
      ) : (
        <form action={createGameAction} className="space-y-2">
          <input type="hidden" name="league_id" value={leagueId} />
          <input
            type="hidden"
            name="series_letter"
            value={series.series_letter}
          />
          <input type="hidden" name="game_number" value={gameNumber} />
          <input
            type="hidden"
            name="away_abbrev"
            value={series.top_seed_abbrev ?? ""}
          />
          <input
            type="hidden"
            name="home_abbrev"
            value={series.bottom_seed_abbrev ?? ""}
          />

          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-ice-200">
              G{gameNumber}
            </span>
            <button
              type="button"
              onClick={onToggleAdd}
              className="text-[9px] text-ice-500 hover:text-ice-300"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="space-y-0.5">
              <Label className="text-[9px]">Start (MDT)</Label>
              <Input
                name="start_time_utc"
                type="datetime-local"
                className="text-[11px] h-7 px-1.5"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px]">Game date</Label>
              <Input
                name="game_date"
                type="date"
                className="text-[11px] h-7 px-1.5"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px]">Venue</Label>
              <Input
                name="venue"
                className="text-[11px] h-7 px-1.5"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[9px]">State</Label>
              <Select
                name="game_state"
                defaultValue="FUT"
                className="text-[11px] h-7 px-1.5"
              >
                <option value="FUT">FUT</option>
                <option value="PRE">PRE</option>
                <option value="LIVE">LIVE</option>
                <option value="FINAL">FINAL</option>
                <option value="OFF">OFF</option>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-ice-400">
            <span>
              {series.top_seed_abbrev ?? "?"} @ {series.bottom_seed_abbrev ?? "?"}
            </span>
            <Button size="sm" type="submit" className="h-6 px-2 text-[10px]">
              Add Game
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

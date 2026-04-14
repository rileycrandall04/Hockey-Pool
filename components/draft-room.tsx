"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { League, Player, Position, Team } from "@/lib/types";
import { teamOnTheClock, pickMeta } from "@/lib/draft";
import { InjuryBadge } from "@/components/injury-badge";

interface DraftablePlayer extends Player {
  nhl_abbrev: string | null;
  fantasy_points: number;
  goals: number;
  assists: number;
  ot_goals: number;
}

interface PickRow {
  id: string;
  league_id: string;
  team_id: string;
  player_id: number;
  round: number;
  pick_number: number;
}

interface Props {
  league: League;
  teams: Team[];
  currentUserId: string;
  isCommissioner: boolean;
}

export function DraftRoom({
  league: initialLeague,
  teams: initialTeams,
  currentUserId,
  isCommissioner,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [league, setLeague] = useState<League>(initialLeague);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [players, setPlayers] = useState<DraftablePlayer[]>([]);
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | "ALL">(
    "ALL",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // "granted" | "denied" | "default" | "unsupported"
  const [notifyPermission, setNotifyPermission] = useState<string>("default");

  // ---- initial data load --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [
        { data: playerRows },
        { data: pickRows },
        { data: overrideRows },
      ] = await Promise.all([
        supabase
          .from("players")
          .select(
            "id, full_name, position, nhl_team_id, jersey_number, headshot_url, active, season_goals, season_assists, season_points, season_games_played, injury_status, injury_description, nhl_teams!inner(abbrev, eliminated), player_stats(goals, assists, ot_goals, fantasy_points)",
          )
          .eq("active", true)
          .eq("nhl_teams.eliminated", false)
          .limit(2000),
        supabase
          .from("draft_picks")
          .select("*")
          .eq("league_id", league.id),
        // Per-league commissioner injury overrides: applied on top of
        // the global players.injury_status when rendering this league's
        // draft room.
        supabase
          .from("league_player_injuries")
          .select("player_id, injury_status, injury_description")
          .eq("league_id", league.id),
      ]);

      if (cancelled) return;

      const overrides = new Map<
        number,
        { injury_status: string | null; injury_description: string | null }
      >();
      for (const o of (overrideRows ?? []) as Array<{
        player_id: number;
        injury_status: string | null;
        injury_description: string | null;
      }>) {
        overrides.set(o.player_id, {
          injury_status: o.injury_status,
          injury_description: o.injury_description,
        });
      }

      setPicks((pickRows ?? []) as PickRow[]);
      const normalized: DraftablePlayer[] = (playerRows ?? []).map(
        (
          p: {
            id: number;
            full_name: string;
            position: Position;
            nhl_team_id: number | null;
            jersey_number: number | null;
            headshot_url: string | null;
            active: boolean;
            season_goals: number | null;
            season_assists: number | null;
            season_points: number | null;
            season_games_played: number | null;
            injury_status: string | null;
            injury_description: string | null;
            nhl_teams:
              | { abbrev: string; eliminated: boolean }
              | { abbrev: string; eliminated: boolean }[]
              | null;
            player_stats:
              | {
                  goals: number;
                  assists: number;
                  ot_goals: number;
                  fantasy_points: number;
                }
              | {
                  goals: number;
                  assists: number;
                  ot_goals: number;
                  fantasy_points: number;
                }[]
              | null;
          },
        ) => {
          const teamRow = Array.isArray(p.nhl_teams) ? p.nhl_teams[0] : p.nhl_teams;
          const statRow = Array.isArray(p.player_stats)
            ? p.player_stats[0]
            : p.player_stats;
          // Per-league override wins over the global NHL feed value.
          const override = overrides.get(p.id);
          return {
            id: p.id,
            full_name: p.full_name,
            position: p.position,
            nhl_team_id: p.nhl_team_id,
            jersey_number: p.jersey_number,
            headshot_url: p.headshot_url,
            active: p.active,
            season_goals: p.season_goals ?? 0,
            season_assists: p.season_assists ?? 0,
            season_points: p.season_points ?? 0,
            season_games_played: p.season_games_played ?? 0,
            injury_status: override?.injury_status ?? p.injury_status,
            injury_description:
              override?.injury_description ?? p.injury_description,
            nhl_abbrev: teamRow?.abbrev ?? null,
            goals: statRow?.goals ?? 0,
            assists: statRow?.assists ?? 0,
            ot_goals: statRow?.ot_goals ?? 0,
            fantasy_points: statRow?.fantasy_points ?? 0,
          };
        },
      );
      setPlayers(normalized);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, league.id]);

  // ---- realtime subscription ---------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`draft-${league.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_picks",
          filter: `league_id=eq.${league.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setPicks((prev) => {
              if (prev.some((p) => p.id === (payload.new as PickRow).id))
                return prev;
              return [...prev, payload.new as PickRow];
            });
          } else if (payload.eventType === "DELETE") {
            setPicks((prev) =>
              prev.filter((p) => p.id !== (payload.old as PickRow).id),
            );
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leagues",
          filter: `id=eq.${league.id}`,
        },
        (payload) => setLeague(payload.new as League),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "teams",
          filter: `league_id=eq.${league.id}`,
        },
        () => {
          // Refetch team list after any change (owner or draft_position).
          supabase
            .from("teams")
            .select("*")
            .eq("league_id", league.id)
            .order("draft_position", {
              ascending: true,
              nullsFirst: false,
            })
            .then(({ data }) => data && setTeams(data as Team[]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, league.id]);

  // ---- turn notifications -------------------------------------------------
  // On mount, snapshot the current notification permission so we can show
  // the right opt-in / on / off state in the UI.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") {
      setNotifyPermission("unsupported");
    } else {
      setNotifyPermission(Notification.permission);
    }
  }, []);

  const requestNotifyPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      setMessage("Browser notifications aren't supported on this device.");
      return;
    }
    const result = await Notification.requestPermission();
    setNotifyPermission(result);
    if (result === "granted") {
      // Fire a confirmation ping so the user knows it's wired up.
      try {
        new Notification("🏒 Notifications on", {
          body: "We'll buzz you when it's your pick.",
          tag: `draft-confirm-${league.id}`,
        });
      } catch {
        // Some browsers reject the immediate call — that's fine.
      }
    }
  }, [league.id]);
  // ---- derived state ------------------------------------------------------
  const pickedPlayerIds = useMemo(
    () => new Set(picks.map((p) => p.player_id)),
    [picks],
  );

  const totalPicks = teams.length * league.roster_size;
  const currentPickIndex = picks.length;
  const draftOver = currentPickIndex >= totalPicks && totalPicks > 0;
  const onClockTeam =
    teams.length > 0 && !draftOver
      ? teamOnTheClock(teams, currentPickIndex)
      : null;
  const isMyTurn = onClockTeam?.owner_id === currentUserId;

  // Fire a vibration + browser notification on the false→true
  // transition. Keeping the previous value in a ref avoids re-firing
  // on every re-render while it's already our turn.
  const wasMyTurnRef = useRef(false);
  useEffect(() => {
    const wasMyTurn = wasMyTurnRef.current;
    wasMyTurnRef.current = isMyTurn;
    if (wasMyTurn || !isMyTurn || draftOver) return;
    if (league.draft_status !== "in_progress") return;

    // Vibration: Android browsers only, no-op everywhere else.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }

    // Browser notification: only if the user opted in.
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification("🏒 You're on the clock!", {
          body: `It's your pick in ${league.name}.`,
          tag: `draft-${league.id}`,
        });
      } catch {
        // Throw is non-fatal; the toast banner below still flags it.
      }
    }
  }, [isMyTurn, draftOver, league.id, league.name, league.draft_status]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => !pickedPlayerIds.has(p.id))
      .filter((p) =>
        positionFilter === "ALL"
          ? true
          : positionFilter === "F"
            ? p.position === "C" || p.position === "L" || p.position === "R" || p.position === "F"
            : p.position === positionFilter,
      )
      .filter(
        (p) =>
          !q ||
          p.full_name.toLowerCase().includes(q) ||
          p.nhl_abbrev?.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Always rank by current-season points; tiebreak by games played.
        const diff = b.season_points - a.season_points;
        if (diff !== 0) return diff;
        return b.season_games_played - a.season_games_played;
      })
      .slice(0, 300);
  }, [players, pickedPlayerIds, positionFilter, search]);

  const rosterByTeam = useMemo(() => {
    const map = new Map<string, PickRow[]>();
    for (const p of picks) {
      const arr = map.get(p.team_id) ?? [];
      arr.push(p);
      map.set(p.team_id, arr);
    }
    return map;
  }, [picks]);

  // ---- actions ------------------------------------------------------------
  // Returns the parsed JSON body on 2xx, or null on failure (after flashing
  // the error message). Callers that care about the response body can
  // inspect the returned value; callers that don't can just ignore it.
  const post = useCallback(
    async <T,>(url: string, body: unknown): Promise<T | null> => {
      setBusy(true);
      setMessage(null);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        setBusy(false);
        setMessage(err instanceof Error ? err.message : "Network error");
        return null;
      }
      setBusy(false);
      if (!res.ok) {
        const txt = await res.text();
        setMessage(txt || "Request failed");
        return null;
      }
      try {
        return (await res.json()) as T;
      } catch {
        return null;
      }
    },
    [],
  );

  // Optimistically add a pick to local state the moment our own API call
  // returns. Supabase Realtime will also fire an INSERT event on the
  // channel, and the subscription handler dedupes by id — so we end up
  // with exactly one copy regardless of which arrives first.
  const applyLocalPick = useCallback((pick: PickRow) => {
    setPicks((prev) =>
      prev.some((p) => p.id === pick.id) ? prev : [...prev, pick],
    );
  }, []);

  const handlePick = async (playerId: number) => {
    if (!onClockTeam) return;
    const result = await post<{ inserted?: PickRow }>("/api/draft/pick", {
      league_id: league.id,
      team_id: onClockTeam.id,
      player_id: playerId,
    });
    if (result?.inserted) applyLocalPick(result.inserted);
  };

  const handleStartDraft = async () => {
    const result = await post<{ league: League; teams: Team[] }>(
      "/api/draft/start",
      { league_id: league.id },
    );
    if (!result?.league) return;
    // Optimistically flip to the live draft view immediately. Realtime
    // UPDATE events will eventually arrive too, but the local update
    // makes sure the commissioner sees the page transition the moment
    // the API responds — even if Realtime is slow or not propagating.
    setLeague(result.league);
    if (result.teams) setTeams(result.teams);
  };

  const handleAutoPick = async () => {
    if (!onClockTeam) return;
    const result = await post<{ inserted?: PickRow }>("/api/draft/autopick", {
      league_id: league.id,
      team_id: onClockTeam.id,
    });
    if (result?.inserted) applyLocalPick(result.inserted);
  };

  // ---- render -------------------------------------------------------------
  if (league.draft_status === "pending") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Waiting to start: {league.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ice-300">
              {teams.length} team{teams.length === 1 ? "" : "s"} have joined.
              Share the join code{" "}
              <span className="font-mono text-ice-100">
                {league.join_code}
              </span>{" "}
              with your pool.
            </p>
            <ul className="space-y-1 text-sm text-ice-200">
              {teams.map((t) => (
                <li key={t.id}>• {t.name}</li>
              ))}
            </ul>
            {isCommissioner && (
              <Button onClick={handleStartDraft} disabled={busy || teams.length < 2}>
                Start draft
              </Button>
            )}
            {!isCommissioner && (
              <p className="text-xs text-ice-400">
                The commissioner will start the draft.
              </p>
            )}
            {message && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {message}
              </div>
            )}
            <Link
              href={`/leagues/${league.id}`}
              className="inline-block text-sm text-ice-400 hover:underline"
            >
              ← Back to league
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/leagues/${league.id}`}
            className="text-sm text-ice-400 hover:underline"
          >
            ← {league.name}
          </Link>
          <h1 className="text-2xl font-bold text-ice-50">Draft room</h1>
          <p className="text-sm text-ice-300">
            Pick {Math.min(currentPickIndex + 1, totalPicks)} of {totalPicks} &middot;
            Round {pickMeta(currentPickIndex, Math.max(teams.length, 1)).round}
          </p>
        </div>
        <div className="rounded-xl border border-puck-border bg-puck-card px-5 py-3 text-right">
          <div className="text-xs uppercase tracking-wide text-ice-400">
            On the clock
          </div>
          <div className="text-xl font-bold text-ice-50">
            {draftOver ? "Draft complete" : onClockTeam?.name ?? "—"}
          </div>
          {isMyTurn && !draftOver && (
            <div className="text-xs text-green-400">It&rsquo;s your pick!</div>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {message}
        </div>
      )}

      {notifyPermission === "default" && (
        <div className="rounded-md border border-puck-border bg-puck-card px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ice-300">
              🔔 Get a buzz + notification when it&rsquo;s your pick.
            </span>
            <button
              type="button"
              onClick={requestNotifyPermission}
              className="rounded-md bg-ice-500 px-3 py-1 text-xs font-medium text-white hover:bg-ice-600"
            >
              Enable notifications
            </button>
          </div>
          <p className="mt-1 text-xs text-ice-500">
            Heads up: this only works while the draft room is open in
            a browser tab — keep the tab alive (don&rsquo;t fully close
            the browser) for the duration of the draft.
          </p>
        </div>
      )}
      {notifyPermission === "granted" && (
        <div className="rounded-md border border-puck-border bg-puck-card px-3 py-2 text-xs text-ice-400">
          🔔 Turn alerts on. We&rsquo;ll vibrate + notify when you&rsquo;re
          on the clock — <strong>only while this tab is open</strong>.
          Fully closing the browser stops alerts.
        </div>
      )}
      {notifyPermission === "denied" && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
          🔕 Notifications are blocked for this site. Re-enable them in
          your browser&rsquo;s site settings to get turn alerts.
          (Vibration on Android still works without permission.)
          Either way, alerts only fire while the draft room tab is open.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>Available players</CardTitle>
            <div className="flex gap-2">
              {(["ALL", "C", "L", "R", "D", "G"] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPositionFilter(pos)}
                  className={`rounded px-2 py-1 text-xs ${
                    positionFilter === pos
                      ? "bg-ice-500 text-white"
                      : "bg-puck-border text-ice-200 hover:bg-ice-800"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="px-3 sm:px-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search player or team..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 min-w-[160px]"
              />
              {(isMyTurn || isCommissioner) && !draftOver && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoPick}
                  disabled={busy}
                >
                  Auto-pick
                </Button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full table-fixed text-[11px] sm:text-sm">
                <colgroup>
                  <col />
                  <col className="w-[28px] sm:w-[44px]" />
                  <col className="w-[32px] sm:w-[44px]" />
                  <col className="hidden w-[36px] sm:table-column" />
                  <col className="w-[34px] sm:w-[44px]" />
                  <col className="w-[44px] sm:w-[64px]" />
                </colgroup>
                <thead className="sticky top-0 bg-puck-card">
                  <tr className="border-b border-puck-border text-left text-ice-400">
                    <th className="px-1.5 py-1.5 sm:px-2 sm:py-2">Player</th>
                    <th className="px-1 py-1.5 sm:px-2 sm:py-2">Pos</th>
                    <th className="px-1 py-1.5 sm:px-2 sm:py-2">Team</th>
                    <th className="hidden px-1 py-1.5 text-right sm:table-cell sm:px-2 sm:py-2">
                      GP
                    </th>
                    <th className="px-1 py-1.5 text-right sm:px-2 sm:py-2">
                      PTS
                    </th>
                    <th className="px-1 py-1.5 sm:px-2 sm:py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-2 py-6 text-center text-ice-400"
                      >
                        No players match your filters.
                      </td>
                    </tr>
                  )}
                  {filteredPlayers.map((p) => (
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
                        {p.nhl_abbrev ?? "—"}
                      </td>
                      <td className="hidden px-1 py-1.5 text-right text-ice-300 sm:table-cell sm:px-2">
                        {p.season_games_played}
                      </td>
                      <td className="px-1 py-1.5 text-right font-semibold text-ice-50 sm:px-2">
                        {p.season_points}
                      </td>
                      <td className="px-1 py-1.5 text-right sm:px-2">
                        <button
                          type="button"
                          onClick={() => handlePick(p.id)}
                          disabled={
                            busy ||
                            draftOver ||
                            (!isMyTurn && !isCommissioner)
                          }
                          aria-label={`Draft ${p.full_name}`}
                          className="inline-flex h-7 min-w-[34px] items-center justify-center rounded bg-ice-500 px-2 text-[11px] font-medium text-white hover:bg-ice-600 disabled:cursor-not-allowed disabled:bg-ice-800 disabled:text-ice-300 sm:h-8 sm:text-xs"
                        >
                          <span className="sm:hidden">+</span>
                          <span className="hidden sm:inline">Draft</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {teams.map((t) => {
              const roster = rosterByTeam.get(t.id) ?? [];
              const isOnClock = onClockTeam?.id === t.id && !draftOver;
              return (
                <div
                  key={t.id}
                  className={`rounded-md border px-3 py-2 ${
                    isOnClock
                      ? "border-ice-500 bg-ice-500/10"
                      : "border-puck-border bg-puck-bg"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-ice-100">{t.name}</div>
                    <div className="text-xs text-ice-400">
                      {roster.length}/{league.roster_size}
                    </div>
                  </div>
                  {roster.length > 0 && (
                    <ul className="mt-1 text-xs text-ice-300">
                      {roster
                        .sort((a, b) => a.pick_number - b.pick_number)
                        .map((pick) => {
                          const player = players.find(
                            (p) => p.id === pick.player_id,
                          );
                          return (
                            <li key={pick.id}>
                              {pick.round}.{pick.pick_number}{" "}
                              <Link
                                href={`/players/${pick.player_id}`}
                                className="hover:underline"
                              >
                                {player?.full_name ?? `#${pick.player_id}`}
                              </Link>
                              {player && ` (${player.position})`}
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

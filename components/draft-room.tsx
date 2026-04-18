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
  nhl_logo: string | null;
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
  /**
   * VAPID public key for Web Push subscription. Passed in as a
   * server-rendered prop (NOT read from process.env at build time)
   * so a freshly-set env var in Vercel takes effect on the next
   * request without needing a full rebuild. Null when the env var
   * isn't configured — the UI then renders a helpful error instead
   * of trying and failing mid-subscribe.
   */
  vapidPublicKey: string | null;
}

export function DraftRoom({
  league: initialLeague,
  teams: initialTeams,
  currentUserId,
  isCommissioner,
  vapidPublicKey,
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
  const [autoDraft, setAutoDraft] = useState(false);
  // ---- draft queue + pick clock state ---------------------------------------
  const queueKey = `draft-queue-${league.id}`;
  const [queue, setQueue] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(queueKey);
      return stored ? (JSON.parse(stored) as number[]) : [];
    } catch { return []; }
  });
  // Sync queue to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem(queueKey, JSON.stringify(queue)); } catch {}
  }, [queue, queueKey]);
  const clockKey = `draft-clock-${league.id}`;
  const clockLimitKey = `draft-clock-limit-${league.id}`;
  const [nextClockLimit, setNextClockLimit] = useState(() => {
    if (typeof window === "undefined") return 300;
    try {
      const stored = localStorage.getItem(clockLimitKey);
      return stored !== null ? Number(stored) : 300;
    } catch { return 300; }
  });
  // Persist limit to localStorage on change
  useEffect(() => {
    try { localStorage.setItem(clockLimitKey, String(nextClockLimit)); } catch {}
  }, [nextClockLimit, clockLimitKey]);
  const activeClockRef = useRef(300);                         // limit used by the running countdown
  const [pickClock, setPickClock] = useState(300);            // current countdown (seconds)
  const pickClockFiringRef = useRef(false);                   // prevent double-fire
  // "granted" | "denied" | "default" | "unsupported"
  const [notifyPermission, setNotifyPermission] = useState<string>("default");
  // Whether the browser currently has an active push subscription for
  // this origin/device. Separate from notifyPermission because the
  // user can have "granted" permission but no live subscription (e.g.,
  // they tapped Allow on the OS prompt but the subscription fetch
  // failed afterwards due to a missing VAPID key).
  const [pushSubscribed, setPushSubscribed] = useState<boolean>(false);

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
            "id, full_name, position, nhl_team_id, jersey_number, headshot_url, active, season_goals, season_assists, season_points, season_games_played, injury_status, injury_description, nhl_teams!inner(abbrev, eliminated, logo_url), player_stats(goals, assists, ot_goals, fantasy_points)",
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
              | { abbrev: string; eliminated: boolean; logo_url: string | null }
              | { abbrev: string; eliminated: boolean; logo_url: string | null }[]
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
            nhl_logo: teamRow?.logo_url ?? null,
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
  // Two layers:
  //
  //   1. In-tab fallback: navigator.vibrate + new Notification, fires on
  //      the isMyTurn transition. Only works while the draft room tab
  //      is open in the foreground or background.
  //
  //   2. Real Web Push (with a service worker). Registered when the user
  //      taps "Enable push notifications" — subscribes via pushManager
  //      and POSTs the subscription to /api/push/subscribe. After that,
  //      the /api/draft/pick route server-side triggers an OS push to
  //      every subscribed device, which works even if the browser is
  //      fully closed and the phone is locked (iOS requires Add to Home
  //      Screen first).
  //
  // On mount, snapshot the current notification permission so we can show
  // the right opt-in / on / off state in the UI. Also check for an
  // existing push subscription — permission alone isn't enough; we
  // need both Notification.permission === "granted" AND an active
  // pushManager subscription to actually deliver closed-browser pushes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") {
      setNotifyPermission("unsupported");
      return;
    }
    setNotifyPermission(Notification.permission);

    // Check for an existing service worker push subscription.
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) setPushSubscribed(true);
      } catch {
        // ignore; we'll just fall back to showing the Enable button
      }
    })();
  }, []);

  const requestNotifyPermission = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") {
      setMessage("Browser notifications aren't supported on this device.");
      return;
    }

    // Step 1: OS-level permission prompt.
    const permission = await Notification.requestPermission();
    setNotifyPermission(permission);
    if (permission !== "granted") return;

    // Step 2: try to register the service worker + subscribe for
    // push. This is what makes notifications work with the browser
    // closed. If anything here fails, we fall back to the in-tab
    // Notification API only — the user still gets alerts while the
    // tab is open, which is better than nothing.
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Push API not supported on this device");
      }
      if (!vapidPublicKey) {
        throw new Error(
          "VAPID public key not configured on the server. " +
            "Set NEXT_PUBLIC_VAPID_PUBLIC_KEY (or VAPID_PUBLIC_KEY) " +
            "in Vercel project env vars and redeploy.",
        );
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Re-use any existing subscription on this device.
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // The PushManager type expects a BufferSource-compatible
          // value. TS gets confused about Uint8Array<ArrayBufferLike>
          // vs Uint8Array<ArrayBuffer>, so cast through unknown.
          applicationServerKey: urlBase64ToUint8Array(
            vapidPublicKey,
          ) as unknown as BufferSource,
        });
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      setPushSubscribed(true);
    } catch (err) {
      // Non-fatal: keep the granted OS permission so the in-tab
      // fallback still works. Just flash a note explaining the
      // limitation.
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(
        `Push subscription failed: ${msg}. Alerts will still work while this tab is open.`,
      );
    }

    // Step 3: fire a confirmation ping so the user knows it's wired up.
    try {
      new Notification("🏒 Notifications on", {
        body: "We'll buzz you when it's your pick.",
        tag: `draft-confirm-${league.id}`,
      });
    } catch {
      // Some browsers reject the immediate call — that's fine.
    }
  }, [league.id, vapidPublicKey]);

  // Send a test push to the current user's subscribed devices. This
  // is the primary diagnostic for "is my iPhone actually receiving
  // pushes from the server?" — iOS PWAs silently drop pushes in all
  // kinds of unhelpful ways (app not added to home screen, phone in
  // focus mode, Safari background notification permission revoked,
  // subscription endpoint invalidated, etc.), and without a test
  // button the only way to find out is to run a real draft.
  //
  // The server returns { sent, dead, errors } which we flash verbatim
  // so the user can report the exact numbers if something's off.
  const sendTestPush = useCallback(async () => {
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | {
            ok: boolean;
            sent?: number;
            dead?: number;
            errors?: number;
            error?: string;
          }
        | null;
      if (!res.ok || !json?.ok) {
        setMessage(
          `Test push failed: ${json?.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }
      const sent = json.sent ?? 0;
      const dead = json.dead ?? 0;
      const errors = json.errors ?? 0;
      if (sent === 0) {
        setMessage(
          `Test push: 0 devices reached${
            dead ? ` (${dead} stale subscription${dead === 1 ? "" : "s"} removed)` : ""
          }. Re-subscribe this device from the banner above.`,
        );
      } else {
        setMessage(
          `Test push sent to ${sent} device${sent === 1 ? "" : "s"}` +
            (dead ? `, ${dead} stale removed` : "") +
            (errors ? `, ${errors} error${errors === 1 ? "" : "s"}` : "") +
            ". If your phone didn't buzz within ~10s, check OS notification settings.",
        );
      }
    } catch (err) {
      setMessage(
        `Test push failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);
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

  const handlePick = useCallback(async (playerId: number) => {
    if (!onClockTeam) return;
    // Cancel pick clock on manual pick — clear stored clock so next pick starts fresh
    try { localStorage.removeItem(clockKey); } catch {}
    setPickClock(nextClockLimit);
    const result = await post<{ inserted?: PickRow }>("/api/draft/pick", {
      league_id: league.id,
      team_id: onClockTeam.id,
      player_id: playerId,
    });
    if (result?.inserted) {
      applyLocalPick(result.inserted);
      // Remove from queue if they were in it
      setQueue((prev) => prev.filter((id) => id !== playerId));
    }
  }, [onClockTeam, league.id, post, applyLocalPick]);

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

  /**
   * Pre-draft random order preview. Hits /api/draft/randomize (see
   * its doc comment for RLS + validity constraints) and patches the
   * local teams list with the returned permutation so the preview
   * updates instantly. Safe to call multiple times — each click is
   * an independent re-roll.
   */
  const handleRandomizeOrder = async () => {
    const result = await post<{ teams: Team[] }>("/api/draft/randomize", {
      league_id: league.id,
    });
    if (result?.teams) setTeams(result.teams);
  };

  const handleAutoPick = async () => {
    if (!onClockTeam) return;
    const result = await post<{ inserted?: PickRow }>("/api/draft/autopick", {
      league_id: league.id,
      team_id: onClockTeam.id,
    });
    if (result?.inserted) applyLocalPick(result.inserted);
  };

  // ---- queue helpers -------------------------------------------------------
  const toggleQueue = useCallback((playerId: number) => {
    setQueue((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId],
    );
  }, []);

  // Auto-clean: remove picked players from queue whenever pickedPlayerIds changes
  useEffect(() => {
    setQueue((prev) => {
      const cleaned = prev.filter((id) => !pickedPlayerIds.has(id));
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, [pickedPlayerIds]);

  // ---- auto-draft effect --------------------------------------------------
  // When autoDraft is on and it becomes our turn, fire an auto-pick after
  // a short delay (gives the UI time to render the transition so the user
  // sees what happened). The ref guard prevents double-fires.
  const autoPickFiringRef = useRef(false);
  useEffect(() => {
    if (
      !autoDraft ||
      !isMyTurn ||
      draftOver ||
      busy ||
      league.draft_status !== "in_progress"
    ) {
      autoPickFiringRef.current = false;
      return;
    }
    if (autoPickFiringRef.current) return;
    autoPickFiringRef.current = true;

    const timer = setTimeout(async () => {
      if (!onClockTeam) return;
      const result = await post<{ inserted?: PickRow }>("/api/draft/autopick", {
        league_id: league.id,
        team_id: onClockTeam.id,
      });
      if (result?.inserted) applyLocalPick(result.inserted);
      autoPickFiringRef.current = false;
    }, 800);

    return () => {
      clearTimeout(timer);
      autoPickFiringRef.current = false;
    };
  }, [autoDraft, isMyTurn, draftOver, busy, league.draft_status, league.id, onClockTeam, post, applyLocalPick]);

  // ---- pick clock -----------------------------------------------------------
  // Persisted via localStorage so the countdown survives page navigation.
  // Stores { startedAt, limit, pickIndex } and calculates remaining time
  // from the wall clock on every tick / remount.
  //
  // prevPickIndexRef distinguishes "initial data load" from "actual new
  // pick via realtime". On mount / refresh, picks start as [] so
  // currentPickIndex is 0, then jumps to the real value once data loads.
  // We only write a new startedAt when we see an actual transition
  // (prev !== null && prev !== current), not on mount.
  const prevPickIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (draftOver || league.draft_status !== "in_progress") {
      prevPickIndexRef.current = currentPickIndex;
      setPickClock(nextClockLimit);
      return;
    }

    const isRealNewPick =
      prevPickIndexRef.current !== null &&
      prevPickIndexRef.current !== currentPickIndex;
    prevPickIndexRef.current = currentPickIndex;

    let startedAt: number;
    let limit: number;
    try {
      const stored = JSON.parse(localStorage.getItem(clockKey) ?? "{}") as {
        startedAt?: number; limit?: number; pickIndex?: number;
      };
      if (stored.pickIndex === currentPickIndex && typeof stored.startedAt === "number" && typeof stored.limit === "number") {
        // Stored clock matches this pick — resume it
        startedAt = stored.startedAt;
        limit = stored.limit;
      } else if (isRealNewPick) {
        // Actual pick transition via realtime — start fresh clock
        startedAt = Date.now();
        limit = nextClockLimit;
        localStorage.setItem(clockKey, JSON.stringify({ startedAt, limit, pickIndex: currentPickIndex }));
      } else {
        // Initial mount / data load, no stored clock for this pick.
        // Don't know when the pick actually started, so start from now
        // and store it so subsequent refreshes resume correctly.
        startedAt = Date.now();
        limit = nextClockLimit;
        localStorage.setItem(clockKey, JSON.stringify({ startedAt, limit, pickIndex: currentPickIndex }));
      }
    } catch {
      startedAt = Date.now();
      limit = nextClockLimit;
    }

    activeClockRef.current = limit;

    if (limit === 0) {
      setPickClock(0);
      return;
    }

    // Calculate remaining from wall clock (handles remount after navigation)
    const calcRemaining = () => Math.max(0, Math.ceil(limit - (Date.now() - startedAt) / 1000));
    setPickClock(calcRemaining());

    const interval = setInterval(() => {
      const remaining = calcRemaining();
      setPickClock(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  // nextClockLimit intentionally excluded — only apply on new pick
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPickIndex, draftOver, league.draft_status, clockKey]);

  // When clock hits 0, pick from queue if available, otherwise auto-pick.
  // After auto-pick, reload the page to refresh all server data.
  useEffect(() => {
    if (pickClock !== 0 || activeClockRef.current === 0 || !isMyTurn || busy || autoDraft || draftOver) return;
    if (pickClockFiringRef.current) return;
    pickClockFiringRef.current = true;

    const firstAvailable = queue.find((id) => !pickedPlayerIds.has(id));
    const afterPick = () => {
      pickClockFiringRef.current = false;
      // Refresh page to ensure all data is current after auto-pick
      window.location.reload();
    };

    if (firstAvailable) {
      handlePick(firstAvailable).then(() => {
        setQueue((prev) => prev.filter((id) => id !== firstAvailable));
        afterPick();
      });
    } else {
      handleAutoPick().then(afterPick);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickClock, isMyTurn, busy, autoDraft, draftOver]);

  // ---- render -------------------------------------------------------------
  if (league.draft_status === "pending") {
    // Does every team have a draft_position yet? If so we're
    // showing the commissioner-previewed order. Otherwise we show
    // the teams in join order with a "not yet randomized" note.
    const hasPreviewOrder =
      teams.length > 0 &&
      teams.every(
        (t) => typeof t.draft_position === "number" && t.draft_position > 0,
      );
    const orderedPendingTeams = hasPreviewOrder
      ? [...teams].sort(
          (a, b) => (a.draft_position ?? 0) - (b.draft_position ?? 0),
        )
      : teams;

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
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ice-400">
                  Draft order
                </h3>
                <span className="text-[10px] text-ice-500">
                  {hasPreviewOrder
                    ? "randomized · snake"
                    : "not yet randomized"}
                </span>
              </div>
              <ol className="space-y-1 text-sm text-ice-200">
                {orderedPendingTeams.map((t, i) => (
                  <li
                    key={t.id}
                    className="flex items-baseline gap-2 rounded border border-puck-border bg-puck-bg/50 px-2 py-1"
                  >
                    <span className="w-5 flex-shrink-0 text-right font-mono text-[11px] text-ice-400">
                      {hasPreviewOrder ? `${i + 1}.` : "—"}
                    </span>
                    <span className="truncate">{t.name}</span>
                  </li>
                ))}
              </ol>
            </div>
            {isCommissioner && (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleRandomizeOrder}
                  disabled={busy || teams.length < 2}
                  variant="secondary"
                >
                  {hasPreviewOrder
                    ? "Re-randomize order"
                    : "Randomize draft order"}
                </Button>
                <Button
                  onClick={handleStartDraft}
                  disabled={busy || teams.length < 2}
                >
                  Start draft
                </Button>
              </div>
            )}
            {isCommissioner && (
              <p className="text-[10px] text-ice-500">
                Randomizing is a preview — re-roll as many times as you
                want. The order locks in when you tap Start draft.
              </p>
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
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-end justify-between gap-3 bg-puck-bg px-4 pb-3 pt-3">
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
          {!draftOver && (
            <div className={`text-xs ${
              isMyTurn && autoDraft
                ? "text-green-400"
                : activeClockRef.current === 0
                  ? "text-green-400"
                  : pickClock <= 60
                    ? "text-red-400"
                    : pickClock <= 120
                      ? "text-amber-400"
                      : "text-ice-300"
            }`}>
              {isMyTurn && autoDraft
                ? "Auto-drafting..."
                : activeClockRef.current === 0
                  ? isMyTurn ? "It\u2019s your pick!" : ""
                  : `${Math.floor(pickClock / 60)}:${String(pickClock % 60).padStart(2, "0")}`}
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {message}
        </div>
      )}

      {/*
        Banner state machine:

          permission=default                → Enable (first-time opt-in)
          permission=granted && !subscribed → Enable (retry push subscribe;
                                              happens when the OS prompt
                                              was accepted but the actual
                                              pushManager.subscribe call
                                              failed, e.g., missing VAPID
                                              key on an earlier build)
          permission=granted && subscribed  → "alerts on" confirmation
          permission=denied                 → help text for re-enabling
          permission=unsupported            → nothing
      */}
      {(notifyPermission === "default" ||
        (notifyPermission === "granted" && !pushSubscribed)) && (
        <div className="rounded-md border border-puck-border bg-puck-card px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ice-300">
              🔔{" "}
              {notifyPermission === "granted"
                ? "Finish enabling draft alerts — tap to subscribe this device."
                : "Get a buzz + notification when it's your pick."}
            </span>
            <button
              type="button"
              onClick={requestNotifyPermission}
              className="rounded-md bg-ice-500 px-3 py-1 text-xs font-medium text-white hover:bg-ice-600"
            >
              {notifyPermission === "granted" ? "Subscribe" : "Enable notifications"}
            </button>
          </div>
          <p className="mt-1 text-xs text-ice-500">
            Subscribed devices receive a push notification when it&rsquo;s
            your turn — even with the browser closed and the phone
            locked. iOS users must Add to Home Screen first.
          </p>
        </div>
      )}
      {notifyPermission === "granted" && pushSubscribed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-puck-border bg-puck-card px-3 py-2 text-xs text-ice-400">
          <span>
            🔔 Push alerts on. We&rsquo;ll vibrate + notify when you&rsquo;re
            on the clock, even if the browser is closed.
          </span>
          <button
            type="button"
            onClick={sendTestPush}
            className="rounded-md border border-ice-500/50 bg-ice-500/10 px-2 py-1 text-[11px] font-medium text-ice-100 hover:bg-ice-500/20"
          >
            Test push
          </button>
        </div>
      )}
      {notifyPermission === "denied" && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
          🔕 Notifications are blocked for this site. Re-enable them in
          your browser&rsquo;s site settings to get turn alerts.
          (Vibration on Android still works without permission.)
        </div>
      )}

      {/* Picks ticker — horizontally scrollable history of the draft,
          default-scrolled to the right so the most recent pick is
          visible. Not auto-moving. */}
      <DraftPicksTicker picks={picks} teams={teams} players={players} />

      {/* Best available — only when it's the user's turn. Shortcut
          to draft one of the top remaining players without scrolling
          the main table. */}
      {isMyTurn && !draftOver && (
        <BestAvailableBox
          players={filteredPlayers.slice(0, 5)}
          onDraft={handlePick}
          disabled={busy}
          queue={queue}
          onToggleQueue={toggleQueue}
        />
      )}

      {/* Draft queue — only shown when queue has items */}
      {queue.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
              Queue ({queue.length})
            </span>
            <button
              type="button"
              onClick={() => setQueue([])}
              className="text-[10px] text-ice-400 hover:text-ice-200"
            >
              Clear all
            </button>
          </div>
          <ol className="space-y-1">
            {queue.map((playerId, idx) => {
              const player = players.find((p) => p.id === playerId);
              if (!player) return null;
              return (
                <li
                  key={playerId}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-xs"
                >
                  <span className="w-4 flex-shrink-0 text-center font-mono text-[10px] font-bold text-amber-400">
                    {idx + 1}
                  </span>
                  {player.nhl_logo && (
                    <img src={player.nhl_logo} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium text-ice-100">
                    {player.full_name}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-ice-400">
                    {player.nhl_abbrev ?? "—"}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[10px] text-ice-300">
                    {player.season_points} pts
                  </span>
                  <button
                    type="button"
                    onClick={() => setQueue((prev) => prev.filter((id) => id !== playerId))}
                    aria-label={`Remove ${player.full_name} from queue`}
                    className="flex-shrink-0 text-ice-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
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
              {(isMyTurn || isCommissioner) && !draftOver && !autoDraft && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoPick}
                  disabled={busy}
                >
                  Auto-pick
                </Button>
              )}
              {!draftOver && (
                <button
                  type="button"
                  onClick={() => setAutoDraft(!autoDraft)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition " +
                    (autoDraft
                      ? "bg-green-500/20 text-green-300 ring-1 ring-green-500/50"
                      : "bg-puck-border text-ice-300 hover:bg-ice-800")
                  }
                >
                  <span
                    className={
                      "inline-block h-2 w-2 rounded-full " +
                      (autoDraft ? "bg-green-400 animate-pulse" : "bg-ice-600")
                    }
                  />
                  {autoDraft ? "Auto ON" : "Auto OFF"}
                </button>
              )}
              {isCommissioner && !draftOver && (
                <select
                  value={nextClockLimit}
                  onChange={(e) => setNextClockLimit(Number(e.target.value))}
                  className="rounded-md bg-puck-border px-2 py-1.5 text-xs text-ice-200 hover:bg-ice-800"
                >
                  <option value={60}>1 min</option>
                  <option value={120}>2 min</option>
                  <option value={180}>3 min</option>
                  <option value={300}>5 min</option>
                  <option value={600}>10 min</option>
                  <option value={0}>No limit</option>
                </select>
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
                  <col className="w-[76px] sm:w-[100px]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-puck-card">
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
                        <div className="flex items-center justify-end gap-1">
                          {!draftOver && (
                            <button
                              type="button"
                              onClick={() => toggleQueue(p.id)}
                              aria-label={queue.includes(p.id) ? `Remove ${p.full_name} from queue` : `Queue ${p.full_name}`}
                              className={
                                "relative inline-flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-[11px] font-medium transition sm:h-8 sm:text-xs " +
                                (queue.includes(p.id)
                                  ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50"
                                  : "bg-puck-border text-ice-300 hover:bg-ice-800")
                              }
                            >
                              Q{queue.includes(p.id) ? queue.indexOf(p.id) + 1 : "+"}
                            </button>
                          )}
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
                        </div>
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
                            <li key={pick.id} className="flex items-center gap-1">
                              <span className="text-ice-500">{pick.round}.{pick.pick_number}</span>
                              {player?.nhl_logo && (
                                <img src={player.nhl_logo} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                              )}
                              <Link
                                href={`/players/${pick.player_id}`}
                                className="hover:underline truncate"
                              >
                                {player?.full_name ?? `#${pick.player_id}`}
                              </Link>
                              {player && <span className="text-ice-500">({player.position})</span>}
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

/**
 * Horizontally scrollable draft picks ticker. Default state is
 * scrolled all the way to the right so the most recent pick is
 * visible; the user can swipe/drag left to see history. Not
 * auto-moving — scrolling is user-driven only.
 *
 * Each chip shows round.pick, team name, player name, and position.
 * When a new pick lands, we auto-scroll back to the right ONLY if
 * the user was already at (or near) the right edge. If they've
 * scrolled left to read history, we leave them alone.
 */
function DraftPicksTicker({
  picks,
  teams,
  players,
}: {
  picks: PickRow[];
  teams: Team[];
  players: DraftablePlayer[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stayAtEndRef = useRef(true);

  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );
  const playerById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  const sorted = useMemo(
    () => [...picks].sort((a, b) => a.pick_number - b.pick_number),
    [picks],
  );

  // Track whether the user has scrolled away from the right edge. If
  // they have, don't snap them back when new picks arrive.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd =
      el.scrollLeft + el.clientWidth >= el.scrollWidth - 16;
    stayAtEndRef.current = atEnd;
  };

  // On mount and on new picks, jump to the right edge if the user is
  // "at end" (which they are by default on first render).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stayAtEndRef.current) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [sorted.length]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-puck-border bg-puck-card px-3 py-2 text-[11px] text-ice-400">
        No picks yet — waiting for the first one.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-puck-border bg-puck-card">
      <div className="flex items-center justify-between px-3 pt-1.5 text-[10px] uppercase tracking-wider text-ice-400">
        <span>Draft picks · newest →</span>
        <span className="text-ice-500">{sorted.length} made</span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex gap-2 overflow-x-auto px-3 pb-2 pt-1"
      >
        {sorted.map((pick) => {
          const team = teamById.get(pick.team_id);
          const player = playerById.get(pick.player_id);
          const isLatest = pick.pick_number === sorted[sorted.length - 1].pick_number;
          return (
            <div
              key={pick.id}
              className={
                "flex min-w-[160px] max-w-[200px] flex-shrink-0 flex-col gap-0.5 rounded-md border px-2.5 py-1.5 " +
                (isLatest
                  ? "border-ice-500 bg-ice-500/10"
                  : "border-puck-border bg-puck-bg")
              }
            >
              <div className="flex items-baseline justify-between gap-2 text-[9px] uppercase tracking-wider text-ice-500">
                <span>
                  R{pick.round}.{pick.pick_number}
                </span>
                <span className="truncate">{team?.name ?? ""}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate text-xs font-semibold text-ice-50">
                {player?.nhl_logo && (
                  <img src={player.nhl_logo} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                )}
                <span className="truncate">{player?.full_name ?? `#${pick.player_id}`}</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-ice-400">
                {player && (
                  <>
                    <span className="rounded bg-puck-border px-1 text-[9px] text-ice-200">
                      {player.position}
                    </span>
                    <span>{player.nhl_abbrev ?? "—"}</span>
                    <span className="ml-auto font-mono text-ice-300">
                      {player.season_points}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Highlighted "Best available" box shown to the user who is on the
 * clock. Lists the top 5 undrafted players (already filtered +
 * sorted upstream by season points) with a prominent Draft button
 * for each so they can pick without scrolling the main table.
 */
function BestAvailableBox({
  players,
  onDraft,
  disabled,
  queue,
  onToggleQueue,
}: {
  players: DraftablePlayer[];
  onDraft: (playerId: number) => void | Promise<void>;
  disabled: boolean;
  queue: number[];
  onToggleQueue: (playerId: number) => void;
}) {
  if (players.length === 0) return null;
  return (
    <div className="rounded-md border-2 border-ice-500 bg-ice-500/10 px-3 py-2 shadow-lg shadow-ice-500/10">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ice-100">
        ✨ Best available — tap to draft
      </div>
      <ul className="space-y-1">
        {players.map((p) => {
          const queueIndex = queue.indexOf(p.id);
          const isQueued = queueIndex !== -1;
          return (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded px-1 py-1 hover:bg-ice-500/10"
            >
              <span
                className={
                  p.position === "D"
                    ? "rounded bg-ice-500/25 px-1 text-[9px] font-semibold text-ice-100"
                    : "rounded bg-puck-border px-1 text-[9px] text-ice-200"
                }
              >
                {p.position}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ice-50">
                {p.full_name}
              </span>
              <span className="flex-shrink-0 text-[10px] text-ice-400">
                {p.nhl_abbrev ?? "—"}
              </span>
              <span className="flex-shrink-0 font-mono text-xs font-bold text-ice-50">
                {p.season_points}
              </span>
              <button
                type="button"
                onClick={() => onToggleQueue(p.id)}
                aria-label={isQueued ? `Remove ${p.full_name} from queue` : `Queue ${p.full_name}`}
                className={
                  "flex-shrink-0 rounded px-2 py-1 text-[10px] font-semibold transition " +
                  (isQueued
                    ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50"
                    : "bg-puck-border text-ice-300 hover:bg-ice-800")
                }
              >
                Q{isQueued ? queueIndex + 1 : "+"}
              </button>
              <button
                type="button"
                onClick={() => onDraft(p.id)}
                disabled={disabled}
                aria-label={`Draft ${p.full_name}`}
                className="flex-shrink-0 rounded bg-ice-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-ice-600 disabled:cursor-not-allowed disabled:bg-ice-800 disabled:text-ice-300"
              >
                Draft
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Convert a base64url-encoded VAPID public key string into the
 * Uint8Array format that pushManager.subscribe() expects as its
 * applicationServerKey. Standard helper from the MDN push docs.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

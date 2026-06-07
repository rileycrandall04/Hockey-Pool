"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { teamOnTheClock } from "@/lib/draft";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Flag } from "@/components/flag";

export interface DraftTeam {
  id: string;
  name: string;
  owner_name: string;
  draft_position: number | null;
}

export interface DraftCountry {
  id: number;
  name: string;
  code: string;
  group_letter: string | null;
  confederation: string | null;
  fifa_rank: number | null;
  flag_url: string | null;
}

export interface DraftPick {
  country_id: number;
  team_id: string;
  round: number;
  pick_number: number;
}

interface DraftRoomProps {
  leagueId: string;
  joinCode: string;
  isCommissioner: boolean;
  myTeamId: string | null;
  draftStatus: "pending" | "in_progress" | "complete";
  rosterSize: number;
  teams: DraftTeam[];
  countries: DraftCountry[];
  picks: DraftPick[];
}

export function DraftRoom(props: DraftRoomProps) {
  const {
    leagueId,
    joinCode,
    isCommissioner,
    myTeamId,
    draftStatus,
    rosterSize,
    teams,
    countries,
    picks,
  } = props;

  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("");
  const [confed, setConfed] = useState("");
  const [query, setQuery] = useState("");

  // Live updates: refresh server data whenever picks or the league row
  // change. (Add draft_picks + leagues to the supabase_realtime
  // publication for this to fire; otherwise use the Refresh button.)
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`draft:${leagueId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks", filter: `league_id=eq.${leagueId}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "leagues", filter: `id=eq.${leagueId}` }, () => router.refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, router]);

  const orderedTeams = useMemo(
    () => [...teams].sort((a, b) => (a.draft_position ?? 99) - (b.draft_position ?? 99)),
    [teams],
  );

  const takenBy = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of picks) map.set(p.country_id, p.team_id);
    return map;
  }, [picks]);

  const onClock =
    draftStatus === "in_progress" && orderedTeams.length > 0
      ? teamOnTheClock(orderedTeams, picks.length)
      : null;
  const myTurn = Boolean(onClock && (onClock.id === myTeamId || isCommissioner));

  const confederations = useMemo(
    () => [...new Set(countries.map((c) => c.confederation).filter(Boolean))].sort() as string[],
    [countries],
  );
  const groups = useMemo(
    () => [...new Set(countries.map((c) => c.group_letter).filter(Boolean))].sort() as string[],
    [countries],
  );

  const available = useMemo(() => {
    return countries
      .filter((c) => !takenBy.has(c.id))
      .filter((c) => !group || c.group_letter === group)
      .filter((c) => !confed || c.confederation === confed)
      .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (a.fifa_rank ?? 999) - (b.fifa_rank ?? 999));
  }, [countries, takenBy, group, confed, query]);

  const countriesById = useMemo(() => {
    const m = new Map<number, DraftCountry>();
    for (const c of countries) m.set(c.id, c);
    return m;
  }, [countries]);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  // ---- Pending: pre-draft lobby --------------------------------------
  if (draftStatus === "pending") {
    const hasOrder = orderedTeams.every((t) => t.draft_position != null);
    return (
      <div className="space-y-4">
        <Banner>
          Draft hasn&rsquo;t started. Share join code{" "}
          <span className="font-mono font-semibold text-ice-50">{joinCode}</span>{" "}
          so friends can join, then the commissioner starts the draft.
        </Banner>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TeamOrderList teams={orderedTeams} showOrder={hasOrder} />
        {isCommissioner && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} variant="secondary" onClick={() => post("/api/draft/randomize", { leagueId })}>
                Randomize order
              </Button>
              <Button disabled={busy} onClick={() => post("/api/draft/start", { leagueId })}>
                Start manual draft
              </Button>
            </div>
            <div className="rounded-md border border-puck-border bg-puck-card p-3">
              <p className="mb-2 text-xs text-ice-400">
                Or skip the live draft entirely: randomize the order and
                auto-pick best-available (by FIFA rank) for everyone. Do this
                once all owners have joined.
              </p>
              <Button
                disabled={busy}
                onClick={() => {
                  if (confirm("Auto-draft the entire league now? This randomizes the order and fills every roster.")) {
                    post("/api/draft/auto-all", { leagueId });
                  }
                }}
              >
                ⚡ Auto-draft entire league
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- In progress / complete ----------------------------------------
  return (
    <div className="space-y-4">
      {draftStatus === "complete" ? (
        <Banner>✅ Draft complete — every country has an owner. Head to Standings.</Banner>
      ) : onClock ? (
        <div
          className={
            "rounded-md border px-4 py-3 text-sm " +
            (myTurn
              ? "border-ice-400 bg-ice-500/15 text-ice-50"
              : "border-puck-border bg-puck-card text-ice-200")
          }
        >
          <span className="font-semibold">On the clock:</span> {onClock.name}{" "}
          <span className="text-ice-400">({onClock.owner_name})</span>
          {myTurn && <span className="ml-2 font-semibold text-ice-100">— your pick!</span>}
        </div>
      ) : null}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Country board */}
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              placeholder="Search countries…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-[200px]"
            />
            <Select value={group} onChange={(e) => setGroup(e.target.value)} className="max-w-[120px]">
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g} value={g}>Group {g}</option>
              ))}
            </Select>
            <Select value={confed} onChange={(e) => setConfed(e.target.value)} className="max-w-[140px]">
              <option value="">All confeds</option>
              {confederations.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
            {myTurn && draftStatus === "in_progress" && (
              <Button disabled={busy} variant="secondary" onClick={() => post("/api/draft/autopick", { leagueId })}>
                Auto-pick best
              </Button>
            )}
          </div>

          {available.length === 0 ? (
            <p className="text-sm text-ice-400">No available countries match your filters.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {available.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy || !myTurn || draftStatus !== "in_progress"}
                    onClick={() => post("/api/draft/pick", { leagueId, countryId: c.id })}
                    className="flex w-full flex-col rounded-md border border-puck-border bg-puck-card px-3 py-2 text-left transition-colors hover:border-ice-400 hover:bg-ice-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-ice-50">
                      <Flag code={c.code} url={c.flag_url} />
                      {c.name}
                    </span>
                    <span className="text-xs text-ice-400">
                      {c.group_letter ? `Grp ${c.group_letter}` : c.confederation ?? ""}
                      {c.fifa_rank ? ` · #${c.fifa_rank}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Rosters */}
        <div className="space-y-3">
          {orderedTeams.map((t) => {
            const roster = picks
              .filter((p) => p.team_id === t.id)
              .sort((a, b) => a.pick_number - b.pick_number)
              .map((p) => countriesById.get(p.country_id));
            const isOnClock = onClock?.id === t.id;
            return (
              <div
                key={t.id}
                className={
                  "rounded-md border p-3 " +
                  (isOnClock ? "border-ice-400 bg-ice-500/10" : "border-puck-border bg-puck-card")
                }
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold text-ice-50">
                    {t.draft_position ? `${t.draft_position}. ` : ""}{t.name}
                    {t.id === myTeamId && <span className="ml-1 text-xs text-ice-400">(you)</span>}
                  </span>
                  <span className="text-xs text-ice-400">{roster.length}/{rosterSize}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {roster.map((c) =>
                    c ? (
                      <span key={c.id} className="inline-flex items-center gap-1 rounded bg-puck-bg px-1.5 py-0.5 text-xs text-ice-200">
                        <Flag code={c.code} url={c.flag_url} />
                        {c.code}
                      </span>
                    ) : null,
                  )}
                  {roster.length === 0 && <span className="text-xs text-ice-500">No picks yet</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Button variant="ghost" size="sm" disabled={busy} onClick={() => router.refresh()}>
        ↻ Refresh
      </Button>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-puck-border bg-puck-card px-4 py-3 text-sm text-ice-200">
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {children}
    </div>
  );
}

function TeamOrderList({ teams, showOrder }: { teams: DraftTeam[]; showOrder: boolean }) {
  return (
    <div className="rounded-md border border-puck-border bg-puck-card p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ice-400">
        {showOrder ? "Draft order" : "Teams"} ({teams.length})
      </div>
      <ol className="space-y-1">
        {teams.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2 text-sm text-ice-100">
            {showOrder && <span className="w-5 text-ice-400">{t.draft_position ?? i + 1}.</span>}
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-ice-400">{t.owner_name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { RosterEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * "Draft Data" view — visualizes which parts of the draft produced
 * the most points. Groups every drafted player by round and shows
 * average and total fantasy points per round, plus a per-pick list
 * sorted by overall pick number so users can scan for late-round
 * gems and early-round busts.
 */
export default async function DraftDataPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const league = await getLeagueForMember(supabase, leagueId, user.id);
  if (!league) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: rosterRows } = await supabase
    .from("v_team_rosters")
    .select("*")
    .eq("league_id", leagueId);

  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, name")
    .eq("league_id", leagueId);

  const teamName = new Map<string, string>();
  for (const t of teamRows ?? []) teamName.set(t.id, t.name);

  const roster = ((rosterRows as RosterEntry[] | null) ?? []).filter(
    (r) => Number.isFinite(r.pick_number),
  );

  // Per-round aggregates: total, count, avg. Round numbers come
  // straight from the draft_picks row so snake-draft math already
  // handled upstream.
  interface RoundStats {
    round: number;
    count: number;
    total: number;
    avg: number;
    best: RosterEntry | null;
  }
  const byRound = new Map<number, RoundStats>();
  for (const r of roster) {
    const existing = byRound.get(r.round) ?? {
      round: r.round,
      count: 0,
      total: 0,
      avg: 0,
      best: null,
    };
    existing.count += 1;
    existing.total += r.fantasy_points;
    if (!existing.best || r.fantasy_points > existing.best.fantasy_points) {
      existing.best = r;
    }
    byRound.set(r.round, existing);
  }
  const rounds = [...byRound.values()].sort((a, b) => a.round - b.round);
  for (const r of rounds) {
    r.avg = r.count === 0 ? 0 : r.total / r.count;
  }
  const maxAvg = rounds.reduce((m, r) => Math.max(m, r.avg), 0);
  const maxTotal = rounds.reduce((m, r) => Math.max(m, r.total), 0);

  const byPick = [...roster].sort(
    (a, b) => a.pick_number - b.pick_number,
  );
  const leagueAvg =
    roster.length === 0
      ? 0
      : roster.reduce((s, r) => s + r.fantasy_points, 0) / roster.length;

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={league.commissioner_id === user.id}
      />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <Link
            href={`/leagues/${leagueId}`}
            className="text-sm text-ice-400 hover:underline"
          >
            ← {league.name}
          </Link>
          <h1 className="text-3xl font-bold text-ice-50">Draft Data</h1>
          <p className="text-sm text-ice-300">
            Fantasy points produced by each part of the draft. Use this
            to spot the rounds where the real value is hiding.
          </p>
        </div>

        {roster.length === 0 ? (
          <Card>
            <CardContent className="px-4 py-6 text-center text-ice-400">
              No draft data yet — come back after the draft completes.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Average points per pick, by round</CardTitle>
                <CardDescription>
                  League-wide average is {leagueAvg.toFixed(1)} pts per
                  drafted player. Taller bars = better-producing rounds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RoundBarChart rounds={rounds} metric="avg" max={maxAvg} />
                <RoundLabels rounds={rounds} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Total points, by round</CardTitle>
                <CardDescription>
                  Raw volume per round. Early rounds have the same
                  number of picks as late rounds, so taller bars here
                  are genuine hotspots.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RoundBarChart rounds={rounds} metric="total" max={maxTotal} />
                <RoundLabels rounds={rounds} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Every pick, in order</CardTitle>
                <CardDescription>
                  Each drafted player by overall pick number. Rows in
                  green beat the league average; red rows fell short.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <PickTable
                  picks={byPick}
                  leagueAvg={leagueAvg}
                  teamName={teamName}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </>
  );
}

/**
 * Pick a "nice" upper bound ≥ max that's easy to tick against —
 * e.g., 47 → 50, 4.2 → 5, 113 → 120. Keeps the Y-axis labels
 * rounded so bars sit against a readable grid instead of against
 * the raw max value.
 */
function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function RoundBarChart({
  rounds,
  metric,
  max,
}: {
  rounds: { round: number; count: number; total: number; avg: number }[];
  metric: "avg" | "total";
  max: number;
}) {
  if (rounds.length === 0) {
    return <p className="text-sm text-ice-400">No picks yet.</p>;
  }
  const yMax = niceMax(max);
  const ticks = [0, yMax / 2, yMax];
  const formatTick = (v: number) =>
    metric === "avg" ? v.toFixed(v < 1 ? 1 : 0) : Math.round(v).toString();
  return (
    <div className="flex w-full gap-2" style={{ height: 260 }}>
      {/* Y-axis */}
      <div className="flex w-8 flex-col justify-between text-right text-[10px] font-mono text-ice-500">
        {[...ticks].reverse().map((t) => (
          <span key={t}>{formatTick(t)}</span>
        ))}
      </div>
      {/* Plot area */}
      <div className="relative min-w-0 flex-1">
        {/* Grid lines */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {ticks.map((t) => (
            <div
              key={t}
              className="border-t border-dashed border-puck-border/50"
            />
          ))}
        </div>
        {/* Bars */}
        <div className="absolute inset-0 flex items-end gap-[2px] sm:gap-1">
          {rounds.map((r) => {
            const value = metric === "avg" ? r.avg : r.total;
            const heightPct = (value / yMax) * 100;
            return (
              <div
                key={r.round}
                className="group flex min-w-0 flex-1 items-end justify-center"
                title={`Round ${r.round} · ${r.count} picks · ${r.total} total pts · ${r.avg.toFixed(1)} avg`}
              >
                <div
                  className="w-full rounded-t bg-gradient-to-t from-ice-600 to-ice-400 transition-opacity group-hover:opacity-90"
                  style={{ height: `${heightPct}%`, minHeight: 2 }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* Right padding to match axis column so bars center correctly */}
    </div>
  );
}

function RoundLabels({
  rounds,
}: {
  rounds: { round: number }[];
}) {
  return (
    <div className="mt-1 flex gap-2">
      <div className="w-8" />
      <div className="flex min-w-0 flex-1 gap-[2px] sm:gap-1">
        {rounds.map((r) => (
          <span
            key={r.round}
            className="min-w-0 flex-1 text-center text-[10px] text-ice-500"
          >
            R{r.round}
          </span>
        ))}
      </div>
    </div>
  );
}

function PickTable({
  picks,
  leagueAvg,
  teamName,
}: {
  picks: RosterEntry[];
  leagueAvg: number;
  teamName: Map<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[520px] text-sm">
      <thead>
        <tr className="border-b border-puck-border text-left text-[10px] uppercase tracking-wider text-ice-400">
          <th className="px-3 py-2">Pick</th>
          <th className="px-3 py-2">Round</th>
          <th className="px-3 py-2">Player</th>
          <th className="px-3 py-2">Pos</th>
          <th className="px-3 py-2">Team</th>
          <th className="px-3 py-2">Owner</th>
          <th className="px-3 py-2 text-right">Pts</th>
        </tr>
      </thead>
      <tbody>
        {picks.map((p) => {
          const diff = p.fantasy_points - leagueAvg;
          const isAbove = diff > 0.5;
          const isBelow = diff < -0.5;
          return (
            <tr
              key={`${p.team_id}-${p.player_id}`}
              className={
                "border-b border-puck-border last:border-0 " +
                (isAbove
                  ? "bg-green-500/5"
                  : isBelow
                    ? "bg-red-500/5"
                    : "")
              }
            >
              <td className="px-3 py-1.5 font-mono text-ice-300">
                #{p.pick_number}
              </td>
              <td className="px-3 py-1.5 text-ice-400">R{p.round}</td>
              <td className="px-3 py-1.5 font-medium text-ice-100">
                <Link
                  href={`/players/${p.player_id}`}
                  className="hover:underline"
                >
                  {p.full_name}
                </Link>
              </td>
              <td className="px-3 py-1.5 text-ice-300">{p.position}</td>
              <td className="px-3 py-1.5 text-ice-300">
                {p.nhl_abbrev ?? "—"}
              </td>
              <td className="px-3 py-1.5 text-ice-400">
                {teamName.get(p.team_id) ?? "?"}
              </td>
              <td
                className={
                  "px-3 py-1.5 text-right font-semibold " +
                  (isAbove
                    ? "text-green-300"
                    : isBelow
                      ? "text-red-300"
                      : "text-ice-200")
                }
              >
                {p.fantasy_points}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

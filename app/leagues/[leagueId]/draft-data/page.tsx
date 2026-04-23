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

  // Undrafted pool: every active player on a non-eliminated NHL team
  // who wasn't picked in this league. Same filter as the draft room
  // so the two views stay consistent. Stats join pulls fantasy_points
  // which is a generated column on player_stats.
  const { data: poolRows } = await supabase
    .from("players")
    .select(
      "id, nhl_teams!inner(eliminated), player_stats(fantasy_points)",
    )
    .eq("active", true)
    .eq("nhl_teams.eliminated", false)
    .limit(2000);

  const teamName = new Map<string, string>();
  for (const t of teamRows ?? []) teamName.set(t.id, t.name);

  const roster = ((rosterRows as RosterEntry[] | null) ?? []).filter(
    (r) => Number.isFinite(r.pick_number),
  );

  // Compute undrafted aggregates. `player_stats` comes back as an
  // array from Supabase's join syntax even though it's a 1:1 — grab
  // the first entry if present.
  type PoolRow = {
    id: number;
    player_stats: { fantasy_points: number }[] | null;
  };
  const draftedIds = new Set(roster.map((r) => r.player_id));
  const undraftedPoints = ((poolRows as unknown as PoolRow[] | null) ?? [])
    .filter((p) => !draftedIds.has(p.id))
    .map((p) => p.player_stats?.[0]?.fantasy_points ?? 0);
  const undraftedCount = undraftedPoints.length;
  const undraftedTotal = undraftedPoints.reduce((s, v) => s + v, 0);
  const undraftedAvg =
    undraftedCount === 0 ? 0 : undraftedTotal / undraftedCount;

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
  const maxAvg = Math.max(
    ...rounds.map((r) => r.avg),
    undraftedAvg,
    0,
  );
  const maxTotal = Math.max(
    ...rounds.map((r) => r.total),
    undraftedTotal,
    0,
  );
  const undrafted = {
    count: undraftedCount,
    total: undraftedTotal,
    avg: undraftedAvg,
  };

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
                  drafted player. The grey <strong>UD</strong> bar at the
                  end shows the average for undrafted pool players —
                  handy for spotting rounds that underperformed the
                  waiver wire.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RoundBarChart
                  rounds={rounds}
                  metric="avg"
                  max={maxAvg}
                  undrafted={undrafted}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Total points, by round</CardTitle>
                <CardDescription>
                  Raw volume per round. Early rounds have the same
                  number of picks as late rounds, so taller bars here
                  are genuine hotspots. The grey <strong>UD</strong>
                  bar is the combined total for every undrafted pool
                  player — usually bigger by sheer headcount.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RoundBarChart
                  rounds={rounds}
                  metric="total"
                  max={maxTotal}
                  undrafted={undrafted}
                />
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
 * Pick a "nice" upper bound just above max so the scale stays tight
 * (bars look tall) but the Y-axis ticks still land on readable
 * numbers. Uses a fine-grained nice-number sequence so a max of 53
 * rounds to 60 rather than 100.
 */
function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = steps.find((s) => s >= normalized) ?? 10;
  return nice * magnitude;
}

function RoundBarChart({
  rounds,
  metric,
  max,
  undrafted,
}: {
  rounds: { round: number; count: number; total: number; avg: number }[];
  metric: "avg" | "total";
  max: number;
  undrafted?: { count: number; total: number; avg: number };
}) {
  if (rounds.length === 0) {
    return <p className="text-sm text-ice-400">No picks yet.</p>;
  }
  const yMax = niceMax(max);
  const ticks = [0, yMax / 2, yMax];
  const formatTick = (v: number) =>
    metric === "avg" ? v.toFixed(v < 1 ? 1 : 0) : Math.round(v).toString();
  const formatValue = (v: number) =>
    metric === "avg" ? v.toFixed(1) : Math.round(v).toString();

  // Build a single list so the bar, round label, and numeric value
  // below stay visually aligned in the same flex cell.
  const columns: {
    key: string;
    label: string;
    value: number;
    title: string;
    isUndrafted: boolean;
  }[] = rounds.map((r) => ({
    key: `r${r.round}`,
    label: `R${r.round}`,
    value: metric === "avg" ? r.avg : r.total,
    title: `Round ${r.round} · ${r.count} picks · ${r.total} total pts · ${r.avg.toFixed(1)} avg`,
    isUndrafted: false,
  }));
  if (undrafted) {
    columns.push({
      key: "ud",
      label: "UD",
      value: metric === "avg" ? undrafted.avg : undrafted.total,
      title: `Undrafted · ${undrafted.count} players · ${undrafted.total} total pts · ${undrafted.avg.toFixed(1)} avg`,
      isUndrafted: true,
    });
  }

  return (
    <div className="flex w-full gap-2">
      {/* Y-axis: each tick absolutely positioned at its own percent
          so the label's vertical center sits on the gridline,
          regardless of how many ticks we draw. */}
      <div className="relative w-8" style={{ height: 260 }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute right-0 translate-y-1/2 text-right text-[10px] font-mono leading-none text-ice-500"
            style={{ bottom: `${(t / yMax) * 100}%` }}
          >
            {formatTick(t)}
          </span>
        ))}
      </div>
      {/* Columns: bar, round label, value */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Plot area */}
        <div className="relative" style={{ height: 260 }}>
          {ticks.map((t) => (
            <div
              key={t}
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-puck-border/50"
              style={{ bottom: `${(t / yMax) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex gap-[2px] sm:gap-1">
            {columns.map((c) => (
              <div
                key={c.key}
                className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                title={c.title}
              >
                <div
                  className={
                    "w-full rounded-t transition-opacity group-hover:opacity-90 " +
                    (c.isUndrafted
                      ? "bg-gradient-to-t from-slate-600 to-slate-400"
                      : "bg-gradient-to-t from-ice-600 to-ice-400")
                  }
                  style={{
                    height: `${(c.value / yMax) * 100}%`,
                    minHeight: 2,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        {/* Round labels */}
        <div className="mt-1 flex gap-[2px] sm:gap-1">
          {columns.map((c) => (
            <span
              key={c.key}
              className={
                "min-w-0 flex-1 text-center text-[10px] " +
                (c.isUndrafted
                  ? "font-semibold uppercase tracking-wider text-slate-300"
                  : "text-ice-500")
              }
            >
              {c.label}
            </span>
          ))}
        </div>
        {/* Numeric values below labels */}
        <div className="flex gap-[2px] sm:gap-1">
          {columns.map((c) => (
            <span
              key={c.key}
              className="min-w-0 flex-1 text-center font-mono text-[10px] font-semibold text-ice-200"
            >
              {formatValue(c.value)}
            </span>
          ))}
        </div>
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

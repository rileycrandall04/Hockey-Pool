import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { getCurrentLeagueContext } from "@/lib/current-league";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Reconciles each player's cumulative `player_stats` row against the
 * sum of their `manual_game_stats` rows. The two should always be
 * equal — every editor / cron / reconciliation path applies deltas
 * to both at the same time — but drift can happen if a write
 * partially fails (player_stats updated but manual_game_stats didn't,
 * or vice versa).
 *
 * This page surfaces those drifts and lets the app owner overwrite
 * `player_stats` with the recomputed sum (which is the authoritative
 * per-game source). It does NOT touch `manual_game_stats`, so once
 * the manual layer is correct (via the NHL reconciliation page or
 * manual stat edits) this page just rolls the totals up.
 */

interface CompareRow {
  player_id: number;
  player_name: string;
  player_team: string;
  expected_goals: number;
  expected_assists: number;
  expected_ot: number;
  expected_fp: number;
  expected_games: number;
  actual_goals: number;
  actual_assists: number;
  actual_ot: number;
  actual_fp: number;
  actual_games: number;
  is_diff: boolean;
}

async function buildComparison(
  svc: ReturnType<typeof createServiceClient>,
): Promise<CompareRow[]> {
  // Pull every manual_game_stats row and aggregate by player_id.
  const { data: manualRows } = await svc
    .from("manual_game_stats")
    .select("player_id, game_id, goals, assists, ot_goals");

  interface Agg {
    goals: number;
    assists: number;
    ot_goals: number;
    games: Set<number>;
  }
  const byPlayer = new Map<number, Agg>();
  for (const r of manualRows ?? []) {
    let agg = byPlayer.get(r.player_id);
    if (!agg) {
      agg = { goals: 0, assists: 0, ot_goals: 0, games: new Set() };
      byPlayer.set(r.player_id, agg);
    }
    agg.goals += r.goals;
    agg.assists += r.assists;
    agg.ot_goals += r.ot_goals;
    if (r.goals > 0 || r.assists > 0 || r.ot_goals > 0) {
      agg.games.add(r.game_id);
    }
  }

  // Pull current player_stats rows.
  const { data: statsRows } = await svc
    .from("player_stats")
    .select("player_id, goals, assists, ot_goals, fantasy_points, games_played");
  const statsByPlayer = new Map<
    number,
    {
      goals: number;
      assists: number;
      ot_goals: number;
      fantasy_points: number;
      games_played: number;
    }
  >();
  for (const r of statsRows ?? []) statsByPlayer.set(r.player_id, r);

  // Union of all player_ids that show up in either side.
  const playerIds = new Set<number>([
    ...byPlayer.keys(),
    ...statsByPlayer.keys(),
  ]);

  // Names + team for display.
  const { data: players } = await svc
    .from("players")
    .select("id, full_name, nhl_teams(abbrev)")
    .in("id", [...playerIds]);
  const info = new Map<number, { name: string; team: string }>();
  for (const p of players ?? []) {
    const team = Array.isArray(p.nhl_teams) ? p.nhl_teams[0] : p.nhl_teams;
    info.set(p.id, {
      name: p.full_name,
      team: team?.abbrev ?? "?",
    });
  }

  const rows: CompareRow[] = [];
  for (const pid of playerIds) {
    const agg = byPlayer.get(pid);
    const stats = statsByPlayer.get(pid);
    const player = info.get(pid);
    if (!player) continue;

    const expG = agg?.goals ?? 0;
    const expA = agg?.assists ?? 0;
    const expOt = Math.min(agg?.ot_goals ?? 0, expG);
    const expFp = expG + expA + 2 * expOt;
    const expGames = agg?.games.size ?? 0;

    const actG = stats?.goals ?? 0;
    const actA = stats?.assists ?? 0;
    const actOt = stats?.ot_goals ?? 0;
    const actFp = stats?.fantasy_points ?? 0;
    const actGames = stats?.games_played ?? 0;

    const isDiff =
      expG !== actG ||
      expA !== actA ||
      expOt !== actOt ||
      expFp !== actFp;

    // Players with no stats on either side aren't interesting.
    if (expG === 0 && expA === 0 && expOt === 0 && actFp === 0) continue;

    rows.push({
      player_id: pid,
      player_name: player.name,
      player_team: player.team,
      expected_goals: expG,
      expected_assists: expA,
      expected_ot: expOt,
      expected_fp: expFp,
      expected_games: expGames,
      actual_goals: actG,
      actual_assists: actA,
      actual_ot: actOt,
      actual_fp: actFp,
      actual_games: actGames,
      is_diff: isDiff,
    });
  }

  // Most interesting first: biggest fantasy-point drift, then by name.
  rows.sort((a, b) => {
    const aGap = Math.abs(a.expected_fp - a.actual_fp);
    const bGap = Math.abs(b.expected_fp - b.actual_fp);
    if (bGap !== aGap) return bGap - aGap;
    return a.player_name.localeCompare(b.player_name);
  });
  return rows;
}

async function applyTotalsAction(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  const svc = createServiceClient();
  const mode = String(formData.get("mode") ?? "selected");

  let playerIds: number[];
  if (mode === "all_diffs") {
    const rows = await buildComparison(svc);
    playerIds = rows.filter((r) => r.is_diff).map((r) => r.player_id);
  } else {
    playerIds = (formData.getAll("player_id") as string[])
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }

  if (playerIds.length === 0) {
    redirect(
      `/admin/reconcile-totals?error=${encodeURIComponent("Nothing selected.")}`,
    );
  }

  // Recompute the expected totals for the selected players.
  const { data: manualRows } = await svc
    .from("manual_game_stats")
    .select("player_id, game_id, goals, assists, ot_goals")
    .in("player_id", playerIds);

  interface Agg {
    goals: number;
    assists: number;
    ot_goals: number;
    games: Set<number>;
  }
  const byPlayer = new Map<number, Agg>();
  for (const r of manualRows ?? []) {
    let agg = byPlayer.get(r.player_id);
    if (!agg) {
      agg = { goals: 0, assists: 0, ot_goals: 0, games: new Set() };
      byPlayer.set(r.player_id, agg);
    }
    agg.goals += r.goals;
    agg.assists += r.assists;
    agg.ot_goals += r.ot_goals;
    if (r.goals > 0 || r.assists > 0 || r.ot_goals > 0) {
      agg.games.add(r.game_id);
    }
  }

  const updates = playerIds.map((pid) => {
    const a = byPlayer.get(pid) ?? {
      goals: 0,
      assists: 0,
      ot_goals: 0,
      games: new Set<number>(),
    };
    return {
      player_id: pid,
      goals: a.goals,
      assists: a.assists,
      ot_goals: Math.min(a.ot_goals, a.goals),
      games_played: a.games.size,
      updated_at: new Date().toISOString(),
    };
  });

  let applied = 0;
  const errors: string[] = [];
  const chunkSize = 500;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const { error } = await svc
      .from("player_stats")
      .upsert(chunk, { onConflict: "player_id" });
    if (error) {
      errors.push(error.message);
    } else {
      applied += chunk.length;
    }
  }

  revalidatePath("/admin/reconcile-totals");
  revalidatePath("/", "layout");

  const params = new URLSearchParams();
  params.set(
    "success",
    `Reconciled ${applied} player${applied === 1 ? "" : "s"} from manual game stats.`,
  );
  if (errors.length > 0) {
    params.set(
      "error",
      `${errors.length} error(s): ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}`,
    );
  }
  redirect(`/admin/reconcile-totals?${params.toString()}`);
}

export default async function ReconcileTotalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const { view = "diffs", success, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const leagueCtx = await getCurrentLeagueContext(user.id);
  const svc = createServiceClient();

  const allRows = await buildComparison(svc);
  const diffRows = allRows.filter((r) => r.is_diff);
  const displayRows = view === "all" ? allRows : diffRows;

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueCtx.leagueId}
        draftStatus={leagueCtx.draftStatus}
        isCommissioner={leagueCtx.isCommissioner}
        isOwner
      />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/dashboard"
          className="text-sm text-ice-400 hover:underline"
        >
          ← Dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
          Reconcile player totals
        </h1>
        <p className="text-sm text-ice-300">
          Compares each player&rsquo;s cumulative <code>player_stats</code>
          {" "}row against the sum of their <code>manual_game_stats</code>
          {" "}rows. The two should always match — when they drift,
          team totals on the standings can stay stale even after stat
          edits. Apply rewrites <code>player_stats</code> to match the
          per-game data.
        </p>

        {success && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            {success}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ice-400">Filter:</span>
          <Link
            href="/admin/reconcile-totals?view=diffs"
            className={
              view === "diffs"
                ? "rounded bg-ice-500/30 px-2 py-1 font-medium text-ice-50"
                : "rounded px-2 py-1 text-ice-300 hover:bg-puck-border/40"
            }
          >
            Differences only ({diffRows.length})
          </Link>
          <Link
            href="/admin/reconcile-totals?view=all"
            className={
              view === "all"
                ? "rounded bg-ice-500/30 px-2 py-1 font-medium text-ice-50"
                : "rounded px-2 py-1 text-ice-300 hover:bg-puck-border/40"
            }
          >
            All players with stats ({allRows.length})
          </Link>
        </div>

        <form action={applyTotalsAction}>
          <input type="hidden" name="mode" value="selected" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Apply selected</Button>
          </div>

          {displayRows.length === 0 ? (
            <Card className="mt-4">
              <CardContent className="px-4 py-6 text-center text-ice-400">
                {view === "diffs"
                  ? "No drift — every player's cumulative totals match their per-game stats."
                  : "No players with stats yet."}
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-4">
              <CardHeader className="px-4 py-3">
                <CardTitle className="text-base">
                  {displayRows.length} player
                  {displayRows.length === 1 ? "" : "s"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-puck-border text-left text-[10px] uppercase tracking-wider text-ice-400">
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2">Player</th>
                        <th className="px-2 py-2">Team</th>
                        <th className="px-2 py-2 text-right">Sum G</th>
                        <th className="px-2 py-2 text-right">Sum A</th>
                        <th className="px-2 py-2 text-right">Sum OT</th>
                        <th className="px-2 py-2 text-right">Sum FP</th>
                        <th className="px-2 py-2 text-right">Stored G</th>
                        <th className="px-2 py-2 text-right">Stored A</th>
                        <th className="px-2 py-2 text-right">Stored OT</th>
                        <th className="px-2 py-2 text-right">Stored FP</th>
                        <th className="px-2 py-2 text-right">ΔFP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((r) => {
                        const dFp = r.expected_fp - r.actual_fp;
                        return (
                          <tr
                            key={r.player_id}
                            className={
                              "border-b border-puck-border last:border-0 " +
                              (r.is_diff ? "" : "opacity-70")
                            }
                          >
                            <td className="px-3 py-1.5">
                              {r.is_diff ? (
                                <input
                                  type="checkbox"
                                  name="player_id"
                                  value={r.player_id}
                                  defaultChecked
                                />
                              ) : (
                                <span className="text-xs text-ice-500">—</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 font-medium text-ice-100">
                              <Link
                                href={`/players/${r.player_id}`}
                                className="hover:underline"
                              >
                                {r.player_name}
                              </Link>
                            </td>
                            <td className="px-2 py-1.5 text-ice-300">
                              {r.player_team}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ice-200">
                              {r.expected_goals}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ice-200">
                              {r.expected_assists}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ice-200">
                              {r.expected_ot}
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold text-ice-100">
                              {r.expected_fp}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ice-200">
                              {r.actual_goals}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ice-200">
                              {r.actual_assists}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ice-200">
                              {r.actual_ot}
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold text-ice-100">
                              {r.actual_fp}
                            </td>
                            <DiffTd value={dFp} />
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </form>

        {diffRows.length > 0 && (
          <form
            action={applyTotalsAction}
            className="border-t border-puck-border pt-4"
          >
            <input type="hidden" name="mode" value="all_diffs" />
            <Button type="submit" variant="secondary">
              Apply all {diffRows.length} drifts
            </Button>
            <p className="mt-1 text-xs text-ice-500">
              Recomputes every flagged player&rsquo;s cumulative totals
              from their per-game stats in one shot.
            </p>
          </form>
        )}
      </main>
    </>
  );
}

function DiffTd({ value }: { value: number }) {
  if (value === 0) {
    return <td className="px-2 py-1.5 text-right text-ice-500">0</td>;
  }
  return (
    <td
      className={
        "px-2 py-1.5 text-right font-semibold " +
        (value > 0 ? "text-green-300" : "text-red-300")
      }
    >
      {value > 0 ? "+" : ""}
      {value}
    </td>
  );
}

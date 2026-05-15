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
import { fetchGameStats } from "@/lib/nhl-api";

export const dynamic = "force-dynamic";

/**
 * Manual NHL reconciliation page. Pulls fresh per-game NHL stats
 * for every FINAL/OFF playoff game from the season start (Apr 18,
 * 2026) onward and shows them side-by-side with our manual_game_stats
 * rows.
 *
 * The page is read-only by default — clicking "Apply" or "Apply all
 * differences" is what writes anything to player_stats. Goals and
 * assists are the only fields compared/merged; OT goals are left
 * alone so a user-marked OT is never silently dropped.
 */

const SEASON_START = "2026-04-18";

interface StatsTriple {
  goals: number;
  assists: number;
  ot_goals: number;
}

async function applyPlayerStatsDelta(
  svc: ReturnType<typeof createServiceClient>,
  playerId: number,
  delta: StatsTriple,
): Promise<string | null> {
  if (delta.goals === 0 && delta.assists === 0 && delta.ot_goals === 0) {
    return null;
  }
  const { data: existing } = await svc
    .from("player_stats")
    .select("goals, assists, ot_goals, games_played")
    .eq("player_id", playerId)
    .maybeSingle();
  const prev = existing ?? {
    goals: 0,
    assists: 0,
    ot_goals: 0,
    games_played: 0,
  };
  const nextGoals = Math.max(0, prev.goals + delta.goals);
  const nextAssists = Math.max(0, prev.assists + delta.assists);
  const nextOt = Math.max(0, prev.ot_goals + delta.ot_goals);
  const clampedOt = Math.min(nextOt, nextGoals);
  const { error } = await svc.from("player_stats").upsert(
    {
      player_id: playerId,
      goals: nextGoals,
      assists: nextAssists,
      ot_goals: clampedOt,
      games_played: prev.games_played,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id" },
  );
  return error ? error.message : null;
}

/**
 * Run async work over a list with a small concurrency cap so we don't
 * fire 50 simultaneous NHL fetches.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

interface CompareRow {
  game_id: number;
  game_date: string;
  matchup: string;
  player_id: number;
  player_name: string;
  player_team: string;
  ours_goals: number;
  ours_assists: number;
  nhl_goals: number;
  nhl_assists: number;
  is_diff: boolean;
}

/**
 * Pull NHL stats for every FINAL/OFF playoff game since the season
 * start and build a per-(game, player) comparison row. Shared between
 * the page render and the "Apply all differences" server action so
 * both views agree on what's a diff.
 */
async function buildComparison(
  svc: ReturnType<typeof createServiceClient>,
): Promise<CompareRow[]> {
  const { data: games } = await svc
    .from("playoff_games")
    .select(
      "game_id, game_date, start_time_utc, away_abbrev, home_abbrev, game_state",
    )
    .gte("game_date", SEASON_START)
    .in("game_state", ["FINAL", "OFF"])
    .order("game_date", { ascending: false });

  if (!games || games.length === 0) return [];

  // Fetch NHL stats in parallel (capped at 5 concurrent so we don't
  // blow through their rate limit).
  const nhlByGame = new Map<
    number,
    { playerId: number; goals: number; assists: number }[]
  >();
  await mapWithConcurrency(games, 5, async (g) => {
    try {
      const lines = await fetchGameStats(g.game_id);
      nhlByGame.set(g.game_id, lines);
    } catch (err) {
      console.error("Reconcile: NHL fetch failed", g.game_id, err);
      nhlByGame.set(g.game_id, []);
    }
  });

  const gameIds = games.map((g) => g.game_id);
  const { data: manualRows } = await svc
    .from("manual_game_stats")
    .select("game_id, player_id, goals, assists, ot_goals")
    .in("game_id", gameIds);

  const manualByKey = new Map<
    string,
    { goals: number; assists: number; ot_goals: number }
  >();
  for (const r of manualRows ?? []) {
    manualByKey.set(`${r.game_id}:${r.player_id}`, r);
  }

  // Collect every player id we need to label.
  const playerIds = new Set<number>();
  for (const arr of nhlByGame.values()) for (const l of arr) playerIds.add(l.playerId);
  for (const r of manualRows ?? []) playerIds.add(r.player_id);

  const { data: players } = await svc
    .from("players")
    .select("id, full_name, nhl_teams(abbrev)")
    .in("id", [...playerIds]);
  const playerInfo = new Map<number, { name: string; team: string }>();
  for (const p of players ?? []) {
    const team = Array.isArray(p.nhl_teams) ? p.nhl_teams[0] : p.nhl_teams;
    playerInfo.set(p.id, {
      name: p.full_name,
      team: team?.abbrev ?? "?",
    });
  }

  const rows: CompareRow[] = [];
  for (const g of games) {
    const matchup = `${g.away_abbrev ?? "?"} @ ${g.home_abbrev ?? "?"}`;
    const seenPlayers = new Set<number>();
    for (const line of nhlByGame.get(g.game_id) ?? []) {
      seenPlayers.add(line.playerId);
      const info = playerInfo.get(line.playerId);
      if (!info) continue;
      const manual = manualByKey.get(`${g.game_id}:${line.playerId}`);
      const oursG = manual?.goals ?? 0;
      const oursA = manual?.assists ?? 0;
      rows.push({
        game_id: g.game_id,
        game_date: g.game_date ?? "",
        matchup,
        player_id: line.playerId,
        player_name: info.name,
        player_team: info.team,
        ours_goals: oursG,
        ours_assists: oursA,
        nhl_goals: line.goals,
        nhl_assists: line.assists,
        is_diff: oursG !== line.goals || oursA !== line.assists,
      });
    }
    // Manual rows for this game where the player isn't in the NHL
    // line — we credited stats the NHL feed didn't report.
    for (const r of manualRows ?? []) {
      if (r.game_id !== g.game_id) continue;
      if (seenPlayers.has(r.player_id)) continue;
      if (r.goals === 0 && r.assists === 0) continue;
      const info = playerInfo.get(r.player_id);
      if (!info) continue;
      rows.push({
        game_id: g.game_id,
        game_date: g.game_date ?? "",
        matchup,
        player_id: r.player_id,
        player_name: info.name,
        player_team: info.team,
        ours_goals: r.goals,
        ours_assists: r.assists,
        nhl_goals: 0,
        nhl_assists: 0,
        is_diff: true,
      });
    }
  }
  return rows;
}

/**
 * Write NHL goals + assists into manual_game_stats for the given
 * (game, player) pairs and apply the delta to player_stats. OT goals
 * are left alone so an OT marker the user added isn't silently
 * dropped.
 */
async function applyPairs(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
  pairs: { game_id: number; player_id: number }[],
): Promise<{ applied: number; errors: string[] }> {
  const errors: string[] = [];
  let applied = 0;

  // Group by game so each NHL fetch is reused across that game's
  // selected players.
  const byGame = new Map<number, number[]>();
  for (const p of pairs) {
    const arr = byGame.get(p.game_id) ?? [];
    arr.push(p.player_id);
    byGame.set(p.game_id, arr);
  }

  for (const [gameId, playerIds] of byGame) {
    let lines: { playerId: number; goals: number; assists: number }[];
    try {
      lines = await fetchGameStats(gameId);
    } catch (err) {
      errors.push(`game ${gameId}: ${err instanceof Error ? err.message : "fetch failed"}`);
      continue;
    }
    const linesById = new Map(lines.map((l) => [l.playerId, l]));

    for (const pid of playerIds) {
      const nhl = linesById.get(pid);
      const nhlG = nhl?.goals ?? 0;
      const nhlA = nhl?.assists ?? 0;

      const { data: prev } = await svc
        .from("manual_game_stats")
        .select("goals, assists, ot_goals")
        .eq("game_id", gameId)
        .eq("player_id", pid)
        .maybeSingle();
      const prevG = prev?.goals ?? 0;
      const prevA = prev?.assists ?? 0;
      const prevOt = prev?.ot_goals ?? 0;

      const deltaErr = await applyPlayerStatsDelta(svc, pid, {
        goals: nhlG - prevG,
        assists: nhlA - prevA,
        ot_goals: 0,
      });
      if (deltaErr) {
        errors.push(`player ${pid} (game ${gameId}): ${deltaErr}`);
        continue;
      }

      const { error: upsertErr } = await svc
        .from("manual_game_stats")
        .upsert(
          {
            game_id: gameId,
            player_id: pid,
            goals: nhlG,
            assists: nhlA,
            ot_goals: prevOt,
            entered_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game_id,player_id" },
        );
      if (upsertErr) {
        // Roll back the player_stats delta to keep them aligned.
        await applyPlayerStatsDelta(svc, pid, {
          goals: prevG - nhlG,
          assists: prevA - nhlA,
          ot_goals: 0,
        });
        errors.push(`player ${pid} (game ${gameId}) upsert: ${upsertErr.message}`);
        continue;
      }
      applied++;
    }
  }

  return { applied, errors };
}

async function reconcileAction(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  const svc = createServiceClient();
  const mode = String(formData.get("mode") ?? "selected");

  let pairs: { game_id: number; player_id: number }[];
  if (mode === "all_diffs") {
    const rows = await buildComparison(svc);
    pairs = rows
      .filter((r) => r.is_diff)
      .map((r) => ({ game_id: r.game_id, player_id: r.player_id }));
  } else {
    const raw = formData.getAll("pair") as string[];
    pairs = raw
      .map((s) => {
        const [g, p] = s.split(":");
        return { game_id: Number(g), player_id: Number(p) };
      })
      .filter((p) => Number.isFinite(p.game_id) && Number.isFinite(p.player_id));
  }

  if (pairs.length === 0) {
    redirect(
      `/admin/reconcile-stats?error=${encodeURIComponent("Nothing selected.")}`,
    );
  }

  const { applied, errors } = await applyPairs(svc, user.id, pairs);

  revalidatePath("/admin/reconcile-stats");
  revalidatePath("/", "layout");

  const params = new URLSearchParams();
  params.set(
    "success",
    `Applied ${applied} player${applied === 1 ? "" : "s"} from NHL data.`,
  );
  if (errors.length > 0) {
    params.set("error", `${errors.length} error(s): ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}`);
  }
  redirect(`/admin/reconcile-stats?${params.toString()}`);
}

export default async function ReconcileStatsPage({
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

  // Group by game for table sectioning.
  interface GameGroup {
    game_id: number;
    game_date: string;
    matchup: string;
    rows: CompareRow[];
  }
  const grouped: GameGroup[] = [];
  const groupKey = new Map<number, GameGroup>();
  for (const r of displayRows) {
    let g = groupKey.get(r.game_id);
    if (!g) {
      g = {
        game_id: r.game_id,
        game_date: r.game_date,
        matchup: r.matchup,
        rows: [],
      };
      groupKey.set(r.game_id, g);
      grouped.push(g);
    }
    g.rows.push(r);
  }
  for (const g of grouped) {
    g.rows.sort((a, b) => a.player_name.localeCompare(b.player_name));
  }
  grouped.sort((a, b) => b.game_date.localeCompare(a.game_date));

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
          Reconcile with NHL stats
        </h1>
        <p className="text-sm text-ice-300">
          Pulls fresh per-game NHL stats since {SEASON_START} and shows
          them next to our recorded values. Compare is goals + assists
          only — OT goals are preserved as you entered them. Read-only
          until you click <strong>Apply</strong>.
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
            href="/admin/reconcile-stats?view=diffs"
            className={
              view === "diffs"
                ? "rounded bg-ice-500/30 px-2 py-1 font-medium text-ice-50"
                : "rounded px-2 py-1 text-ice-300 hover:bg-puck-border/40"
            }
          >
            Differences only ({diffRows.length})
          </Link>
          <Link
            href="/admin/reconcile-stats?view=all"
            className={
              view === "all"
                ? "rounded bg-ice-500/30 px-2 py-1 font-medium text-ice-50"
                : "rounded px-2 py-1 text-ice-300 hover:bg-puck-border/40"
            }
          >
            All data ({allRows.length})
          </Link>
          <span className="ml-auto text-xs text-ice-500">
            {grouped.length} game{grouped.length === 1 ? "" : "s"}
          </span>
        </div>

        <form action={reconcileAction}>
          <input type="hidden" name="mode" value="selected" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Apply selected</Button>
          </div>

          {grouped.length === 0 ? (
            <Card className="mt-4">
              <CardContent className="px-4 py-6 text-center text-ice-400">
                {view === "diffs"
                  ? "No differences — your data matches the NHL feed."
                  : "No games found since the season start."}
              </CardContent>
            </Card>
          ) : (
            <div className="mt-4 space-y-3">
              {grouped.map((g) => (
                <Card key={g.game_id}>
                  <CardHeader className="px-4 py-3">
                    <CardTitle className="text-base">
                      {g.matchup}
                      <span className="ml-2 text-xs font-normal text-ice-400">
                        {g.game_date} · #{g.game_id}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-puck-border text-left text-[10px] uppercase tracking-wider text-ice-400">
                          <th className="px-3 py-2 w-8"></th>
                          <th className="px-3 py-2">Player</th>
                          <th className="px-2 py-2">Team</th>
                          <th className="px-2 py-2 text-right">Ours G</th>
                          <th className="px-2 py-2 text-right">Ours A</th>
                          <th className="px-2 py-2 text-right">NHL G</th>
                          <th className="px-2 py-2 text-right">NHL A</th>
                          <th className="px-2 py-2 text-right">ΔG</th>
                          <th className="px-2 py-2 text-right">ΔA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => {
                          const dG = r.nhl_goals - r.ours_goals;
                          const dA = r.nhl_assists - r.ours_assists;
                          return (
                            <tr
                              key={`${r.game_id}:${r.player_id}`}
                              className={
                                "border-b border-puck-border last:border-0 " +
                                (r.is_diff ? "" : "opacity-70")
                              }
                            >
                              <td className="px-3 py-1.5">
                                {r.is_diff ? (
                                  <input
                                    type="checkbox"
                                    name="pair"
                                    value={`${r.game_id}:${r.player_id}`}
                                    defaultChecked
                                  />
                                ) : (
                                  <span className="text-xs text-ice-500">—</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 font-medium text-ice-100">
                                {r.player_name}
                              </td>
                              <td className="px-2 py-1.5 text-ice-300">
                                {r.player_team}
                              </td>
                              <td className="px-2 py-1.5 text-right text-ice-200">
                                {r.ours_goals}
                              </td>
                              <td className="px-2 py-1.5 text-right text-ice-200">
                                {r.ours_assists}
                              </td>
                              <td className="px-2 py-1.5 text-right text-ice-200">
                                {r.nhl_goals}
                              </td>
                              <td className="px-2 py-1.5 text-right text-ice-200">
                                {r.nhl_assists}
                              </td>
                              <DiffTd value={dG} />
                              <DiffTd value={dA} />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </form>

        {diffRows.length > 0 && (
          <form action={reconcileAction} className="border-t border-puck-border pt-4">
            <input type="hidden" name="mode" value="all_diffs" />
            <Button type="submit" variant="secondary">
              Apply all {diffRows.length} differences
            </Button>
            <p className="mt-1 text-xs text-ice-500">
              Re-fetches every flagged game and applies the NHL values
              in one shot. OT goals are not touched.
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
        "px-2 py-1.5 text-right font-medium " +
        (value > 0 ? "text-green-300" : "text-red-300")
      }
    >
      {value > 0 ? "+" : ""}
      {value}
    </td>
  );
}

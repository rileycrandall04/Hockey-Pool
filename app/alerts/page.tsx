import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { getCurrentLeagueContext } from "@/lib/current-league";
import { NavBar } from "@/components/nav-bar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Delta helper (same as /games/[gameId]/stats)                       */
/* ------------------------------------------------------------------ */

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
  const { error } = await svc
    .from("player_stats")
    .upsert(
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

/* ------------------------------------------------------------------ */
/*  Server actions                                                     */
/* ------------------------------------------------------------------ */

async function acceptCronAction(formData: FormData) {
  "use server";
  const conflictId = String(formData.get("conflict_id") ?? "");
  if (!conflictId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  const svc = createServiceClient();

  // Read the conflict row
  const { data: conflict } = await svc
    .from("stat_conflicts")
    .select("*")
    .eq("id", conflictId)
    .single();
  if (!conflict || conflict.resolved) {
    redirect("/alerts");
  }

  // Compute delta: (cron values) - (manual values)
  const delta: StatsTriple = {
    goals: conflict.cron_goals - conflict.manual_goals,
    assists: conflict.cron_assists - conflict.manual_assists,
    ot_goals: conflict.cron_ot_goals - conflict.manual_ot_goals,
  };

  // Apply delta to player_stats
  const deltaError = await applyPlayerStatsDelta(
    svc,
    conflict.player_id,
    delta,
  );
  if (deltaError) {
    redirect(
      `/alerts?error=${encodeURIComponent(`player_stats update: ${deltaError}`)}`,
    );
  }

  // Update manual_game_stats row to match cron values
  await svc
    .from("manual_game_stats")
    .update({
      goals: conflict.cron_goals,
      assists: conflict.cron_assists,
      ot_goals: conflict.cron_ot_goals,
      updated_at: new Date().toISOString(),
    })
    .eq("game_id", conflict.game_id)
    .eq("player_id", conflict.player_id);

  // Mark conflict resolved
  await svc
    .from("stat_conflicts")
    .update({
      resolved: true,
      resolution: "accepted_cron",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", conflictId);

  revalidatePath("/alerts");
  redirect("/alerts");
}

async function keepManualAction(formData: FormData) {
  "use server";
  const conflictId = String(formData.get("conflict_id") ?? "");
  if (!conflictId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  const svc = createServiceClient();

  // Mark conflict resolved — no stat changes needed since manual
  // values are already applied to player_stats
  await svc
    .from("stat_conflicts")
    .update({
      resolved: true,
      resolution: "kept_manual",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", conflictId);

  revalidatePath("/alerts");
  redirect("/alerts");
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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

  // Unresolved conflicts
  const { data: unresolvedRows } = await svc
    .from("stat_conflicts")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  const unresolved = unresolvedRows ?? [];

  // Resolved conflicts (last 20)
  const { data: resolvedRows } = await svc
    .from("stat_conflicts")
    .select("*")
    .eq("resolved", true)
    .order("resolved_at", { ascending: false })
    .limit(20);
  const resolved = resolvedRows ?? [];

  // Fetch player names for all conflicts
  const allPlayerIds = [
    ...new Set([
      ...unresolved.map((c) => c.player_id),
      ...resolved.map((c) => c.player_id),
    ]),
  ];
  const playerNames = new Map<number, string>();
  if (allPlayerIds.length > 0) {
    const { data: players } = await svc
      .from("players")
      .select("id, full_name")
      .in("id", allPlayerIds);
    for (const p of players ?? []) {
      playerNames.set(p.id, p.full_name);
    }
  }

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueCtx.leagueId}
        draftStatus={leagueCtx.draftStatus}
        isCommissioner={leagueCtx.isCommissioner}
        isOwner
        alertCount={unresolved.length}
      />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/dashboard"
          className="text-sm text-ice-400 hover:underline"
        >
          &larr; Dashboard
        </Link>

        <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
          Stat Conflicts
        </h1>
        <p className="text-sm text-ice-300">
          When you enter stats manually before the nightly cron runs, the
          cron skips those players to avoid double-counting. If the NHL
          data differs from what you entered, a conflict is created here
          for review.
        </p>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {unresolved.length === 0 ? (
          <Card>
            <CardContent className="px-4 py-6 text-center text-ice-400">
              No unresolved conflicts.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {unresolved.map((c) => (
              <ConflictCard
                key={c.id}
                conflict={c}
                playerName={playerNames.get(c.player_id) ?? `Player ${c.player_id}`}
              />
            ))}
          </div>
        )}

        {resolved.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-medium text-ice-300 hover:text-ice-100">
              Resolved conflicts ({resolved.length})
            </summary>
            <div className="mt-3 space-y-3">
              {resolved.map((c) => (
                <Card key={c.id} className="opacity-60">
                  <CardContent className="px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ice-200">
                        {playerNames.get(c.player_id) ?? `Player ${c.player_id}`}
                      </span>
                      <span className="text-xs text-ice-400">
                        Game {c.game_id}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-ice-400">
                      {c.resolution === "accepted_cron"
                        ? "Resolved: accepted NHL data"
                        : "Resolved: kept manual data"}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </details>
        )}
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Conflict card                                                      */
/* ------------------------------------------------------------------ */

interface ConflictRow {
  id: string;
  game_id: number;
  player_id: number;
  manual_goals: number;
  manual_assists: number;
  manual_ot_goals: number;
  cron_goals: number;
  cron_assists: number;
  cron_ot_goals: number;
  created_at: string;
}

function ConflictCard({
  conflict: c,
  playerName,
}: {
  conflict: ConflictRow;
  playerName: string;
}) {
  const goalsDiff = c.cron_goals - c.manual_goals;
  const assistsDiff = c.cron_assists - c.manual_assists;
  const otDiff = c.cron_ot_goals - c.manual_ot_goals;

  return (
    <Card>
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-base">
          {playerName}
          <span className="ml-2 text-xs font-normal text-ice-400">
            Game {c.game_id}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-sm">
          <div />
          <div className="text-center text-xs font-medium text-ice-400">G</div>
          <div className="text-center text-xs font-medium text-ice-400">A</div>
          <div className="text-center text-xs font-medium text-ice-400">OT</div>

          <div className="text-ice-300">Your data</div>
          <div className="text-center text-ice-100">{c.manual_goals}</div>
          <div className="text-center text-ice-100">{c.manual_assists}</div>
          <div className="text-center text-ice-100">{c.manual_ot_goals}</div>

          <div className="text-ice-300">NHL data</div>
          <div className="text-center text-ice-100">{c.cron_goals}</div>
          <div className="text-center text-ice-100">{c.cron_assists}</div>
          <div className="text-center text-ice-100">{c.cron_ot_goals}</div>

          <div className="text-ice-400">Diff</div>
          <DiffCell value={goalsDiff} />
          <DiffCell value={assistsDiff} />
          <DiffCell value={otDiff} />
        </div>

        <div className="flex gap-2 pt-1">
          <form action={acceptCronAction}>
            <input type="hidden" name="conflict_id" value={c.id} />
            <Button type="submit" size="sm" variant="primary">
              Accept NHL Data
            </Button>
          </form>
          <form action={keepManualAction}>
            <input type="hidden" name="conflict_id" value={c.id} />
            <Button type="submit" size="sm" variant="secondary">
              Keep My Data
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function DiffCell({ value }: { value: number }) {
  if (value === 0) {
    return <div className="text-center text-ice-500">0</div>;
  }
  return (
    <div
      className={`text-center font-medium ${value > 0 ? "text-green-300" : "text-red-300"}`}
    >
      {value > 0 ? "+" : ""}
      {value}
    </div>
  );
}

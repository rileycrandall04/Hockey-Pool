import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentLeagueContext } from "@/lib/current-league";
import type { DailyRecap, ManualGameStat } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Helpers shared by the server actions below. Centralized here so the
 * save/delete flows don't drift — both need to: authorize the caller,
 * read the previous manual row (to compute a delta against the current
 * values), apply that delta to player_stats, then persist the manual
 * row itself.
 */

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
  // No-op if nothing changed.
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
  // ot_goals must never exceed goals in player_stats either, since the
  // scoring view interprets them as a subset.
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

/**
 * Upsert a manual (game_id, player_id) entry with absolute G/A/OT
 * values. Computes the delta against the previous manual row for this
 * (game, player) pair and applies it to the cumulative player_stats
 * totals so standings reflect the change without re-running anything.
 */
async function upsertManualStatsAction(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("game_id"));
  const playerId = Number(formData.get("player_id"));
  if (!Number.isFinite(gameId) || !Number.isFinite(playerId)) {
    redirect(
      `/games/${formData.get("game_id") ?? ""}/edit?error=${encodeURIComponent("Invalid game or player id")}`,
    );
  }

  const parseNonNegInt = (name: string): number | string => {
    const raw = String(formData.get(name) ?? "").trim();
    if (raw === "") return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      return `${name.replace("_", " ")} must be a non-negative integer`;
    }
    return n;
  };

  const goals = parseNonNegInt("goals");
  const assists = parseNonNegInt("assists");
  const otGoals = parseNonNegInt("ot_goals");
  for (const v of [goals, assists, otGoals]) {
    if (typeof v === "string") {
      redirect(
        `/games/${gameId}/edit?error=${encodeURIComponent(v)}`,
      );
    }
  }
  if ((otGoals as number) > (goals as number)) {
    redirect(
      `/games/${gameId}/edit?error=${encodeURIComponent("OT goals cannot exceed total goals (an OT goal is also counted as a regular goal).")}`,
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) {
    redirect(
      `/games/${gameId}/edit?error=${encodeURIComponent("Only the app owner can edit game stats.")}`,
    );
  }

  const svc = createServiceClient();

  // Previous manual row for this (game, player) pair. Null if this is
  // the first time we're writing stats for this player in this game.
  const { data: prev } = await svc
    .from("manual_game_stats")
    .select("goals, assists, ot_goals")
    .eq("game_id", gameId)
    .eq("player_id", playerId)
    .maybeSingle<StatsTriple>();

  const delta: StatsTriple = {
    goals: (goals as number) - (prev?.goals ?? 0),
    assists: (assists as number) - (prev?.assists ?? 0),
    ot_goals: (otGoals as number) - (prev?.ot_goals ?? 0),
  };

  const deltaError = await applyPlayerStatsDelta(svc, playerId, delta);
  if (deltaError) {
    redirect(
      `/games/${gameId}/edit?error=${encodeURIComponent(`player_stats update: ${deltaError}`)}`,
    );
  }

  const { error: upsertError } = await svc.from("manual_game_stats").upsert(
    {
      game_id: gameId,
      player_id: playerId,
      goals: goals as number,
      assists: assists as number,
      ot_goals: otGoals as number,
      entered_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "game_id,player_id" },
  );
  if (upsertError) {
    // We already applied the delta — try to roll it back so we don't
    // leave player_stats ahead of the manual row. Best-effort.
    await applyPlayerStatsDelta(svc, playerId, {
      goals: -delta.goals,
      assists: -delta.assists,
      ot_goals: -delta.ot_goals,
    });
    redirect(
      `/games/${gameId}/edit?error=${encodeURIComponent(`manual_game_stats upsert: ${upsertError.message}`)}`,
    );
  }

  revalidatePath(`/games/${gameId}/edit`);
  redirect(
    `/games/${gameId}/edit?success=${encodeURIComponent(`Saved: ${goals}G ${assists}A ${otGoals}OT`)}`,
  );
}

/**
 * Remove a manual (game_id, player_id) entry and back out its
 * contribution to player_stats.
 */
async function deleteManualStatsAction(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("game_id"));
  const playerId = Number(formData.get("player_id"));
  if (!Number.isFinite(gameId) || !Number.isFinite(playerId)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) {
    redirect(
      `/games/${gameId}/edit?error=${encodeURIComponent("Only the app owner can edit game stats.")}`,
    );
  }

  const svc = createServiceClient();
  const { data: prev } = await svc
    .from("manual_game_stats")
    .select("goals, assists, ot_goals")
    .eq("game_id", gameId)
    .eq("player_id", playerId)
    .maybeSingle<StatsTriple>();
  if (!prev) {
    redirect(`/games/${gameId}/edit?error=${encodeURIComponent("Row not found")}`);
  }

  const deltaError = await applyPlayerStatsDelta(svc, playerId, {
    goals: -prev!.goals,
    assists: -prev!.assists,
    ot_goals: -prev!.ot_goals,
  });
  if (deltaError) {
    redirect(
      `/games/${gameId}/edit?error=${encodeURIComponent(`player_stats rollback: ${deltaError}`)}`,
    );
  }

  const { error: deleteError } = await svc
    .from("manual_game_stats")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", playerId);
  if (deleteError) {
    redirect(
      `/games/${gameId}/edit?error=${encodeURIComponent(`manual_game_stats delete: ${deleteError.message}`)}`,
    );
  }

  revalidatePath(`/games/${gameId}/edit`);
  redirect(
    `/games/${gameId}/edit?success=${encodeURIComponent("Entry removed")}`,
  );
}

/**
 * Per-game manual stats editor for the app owner. Reached by tapping a
 * game in the home-page ticker. Shows the game header, every existing
 * manual entry with inline save/delete forms, and an "Add stats"
 * form with a player picker scoped to the two teams in the game.
 */
export default async function GameEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { gameId: gameIdParam } = await params;
  const gameId = Number(gameIdParam);
  if (!Number.isFinite(gameId)) notFound();
  const { success, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!isAppOwner(user.email)) {
    // Bounce non-owners straight back to the dashboard with a flash.
    redirect(
      "/dashboard?seed_error=" +
        encodeURIComponent("Only the app owner can edit game stats."),
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: recap } = await supabase
    .from("daily_recaps")
    .select("*")
    .eq("game_id", gameId)
    .maybeSingle<DailyRecap>();
  if (!recap) notFound();

  // Existing manual entries for this game, joined with player + team
  // info so we can show readable names instead of bare ids.
  const { data: manualRows } = await supabase
    .from("manual_game_stats")
    .select(
      "id, game_id, player_id, goals, assists, ot_goals, updated_at, players(full_name, position, nhl_teams(abbrev))",
    )
    .eq("game_id", gameId)
    .order("updated_at", { ascending: false });

  type ManualRow = ManualGameStat & {
    players?: {
      full_name?: string;
      position?: string;
      nhl_teams?: { abbrev?: string } | Array<{ abbrev?: string }>;
    } | null;
  };
  const manualEntries = (manualRows ?? []) as unknown as ManualRow[];

  // Players from the two teams in this game, for the add-stats
  // dropdown. We pull the team ids first so we can filter players by
  // nhl_team_id — the players table doesn't have an abbrev column.
  const { data: teamRows } = await supabase
    .from("nhl_teams")
    .select("id, abbrev")
    .in("abbrev", [recap.away_team_abbrev, recap.home_team_abbrev]);
  const teamIds = (teamRows ?? []).map((t) => t.id);
  const abbrevById = new Map<number, string>(
    (teamRows ?? []).map((t) => [t.id, t.abbrev as string]),
  );

  const { data: playerRows } = await supabase
    .from("players")
    .select("id, full_name, position, nhl_team_id")
    .in("nhl_team_id", teamIds.length > 0 ? teamIds : [-1])
    .order("full_name", { ascending: true });

  const leagueCtx = await getCurrentLeagueContext(user.id);

  const gameTitle = `${recap.away_team_abbrev} ${recap.away_team_score}–${recap.home_team_score} ${recap.home_team_abbrev}`;

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueCtx.leagueId}
        draftStatus={leagueCtx.draftStatus}
        isCommissioner={leagueCtx.isCommissioner}
        isOwner
      />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <BackButton
          fallbackHref={
            leagueCtx.leagueId ? `/leagues/${leagueCtx.leagueId}` : "/dashboard"
          }
          className="text-sm text-ice-400 hover:underline"
        >
          ← Back
        </BackButton>

        <header>
          <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
            {gameTitle}
            {recap.was_overtime && (
              <span className="ml-2 text-sm uppercase tracking-wider text-ice-400">
                OT
              </span>
            )}
          </h1>
          <p className="text-xs text-ice-400">
            {recap.game_date} &middot; Game {gameId}
          </p>
        </header>

        {success && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            ✅ {success}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            ❌ {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>How this works</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-ice-400">
              Each row below is a manual override for one
              (game, player) pair. Saving a row applies the delta
              against its previous value to the global{" "}
              <code className="rounded bg-puck-bg px-1">player_stats</code>{" "}
              totals &mdash; standings, team rosters, and pool points
              update immediately. Deleting a row backs out its
              contribution.
            </p>
            <p className="mt-2 text-xs text-ice-400">
              Use this to{" "}
              <strong>add stats the nightly sync missed</strong>. For
              fixing stats the sync attributed to the{" "}
              <em>wrong</em> player, use the per-player editor on
              that player&rsquo;s detail page instead &mdash; manual
              rows here can only add, not remove, what the cron has
              already written.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual entries ({manualEntries.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {manualEntries.length === 0 ? (
              <p className="text-xs text-ice-500">
                No manual entries for this game yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {manualEntries.map((row) => {
                  const team = Array.isArray(row.players?.nhl_teams)
                    ? row.players?.nhl_teams[0]
                    : row.players?.nhl_teams;
                  const name = row.players?.full_name ?? `#${row.player_id}`;
                  return (
                    <li
                      key={row.id}
                      className="rounded-md border border-puck-border bg-puck-bg/60 p-3"
                    >
                      <div className="mb-2 flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ice-100">
                          <span className="mr-1 text-[10px] text-ice-500">
                            {team?.abbrev ?? "—"}
                          </span>
                          {name}
                          <span className="ml-1 text-[10px] text-ice-500">
                            {row.players?.position ?? ""}
                          </span>
                        </span>
                      </div>
                      <form
                        action={upsertManualStatsAction}
                        className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="game_id"
                          value={gameId}
                        />
                        <input
                          type="hidden"
                          name="player_id"
                          value={row.player_id}
                        />
                        <StatField
                          label="G"
                          name="goals"
                          defaultValue={row.goals}
                        />
                        <StatField
                          label="A"
                          name="assists"
                          defaultValue={row.assists}
                        />
                        <StatField
                          label="OT"
                          name="ot_goals"
                          defaultValue={row.ot_goals}
                        />
                        <Button size="sm" type="submit">
                          Save
                        </Button>
                      </form>
                      <form
                        action={deleteManualStatsAction}
                        className="mt-2 flex justify-end"
                      >
                        <input
                          type="hidden"
                          name="game_id"
                          value={gameId}
                        />
                        <input
                          type="hidden"
                          name="player_id"
                          value={row.player_id}
                        />
                        <Button
                          size="sm"
                          type="submit"
                          variant="danger"
                        >
                          Remove entry
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add stats for a player</CardTitle>
          </CardHeader>
          <CardContent>
            {(playerRows ?? []).length === 0 ? (
              <p className="text-xs text-ice-500">
                No players loaded for {recap.away_team_abbrev} /{" "}
                {recap.home_team_abbrev}. Make sure the player pool is
                seeded for those teams.
              </p>
            ) : (
              <form
                action={upsertManualStatsAction}
                className="space-y-3"
              >
                <input type="hidden" name="game_id" value={gameId} />
                <div className="space-y-1">
                  <Label htmlFor="add-player">Player</Label>
                  <select
                    id="add-player"
                    name="player_id"
                    required
                    defaultValue=""
                    className="w-full rounded-md border border-puck-border bg-puck-bg px-3 py-2 text-sm text-ice-50 focus:outline-none focus:ring-2 focus:ring-ice-500"
                  >
                    <option value="" disabled>
                      Select a player…
                    </option>
                    {(playerRows ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {(abbrevById.get(p.nhl_team_id ?? -1) ?? "—") +
                          " · " +
                          p.full_name +
                          " (" +
                          p.position +
                          ")"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <StatField label="Goals" name="goals" defaultValue={0} />
                  <StatField
                    label="Assists"
                    name="assists"
                    defaultValue={0}
                  />
                  <StatField
                    label="OT Goals"
                    name="ot_goals"
                    defaultValue={0}
                  />
                </div>
                <p className="text-[10px] text-ice-500">
                  OT goals count inside the Goals total. Entering
                  &ldquo;1G / 1OT&rdquo; gives the player one goal
                  which was scored in overtime (worth 3 pool points).
                </p>
                <Button type="submit">Add entry</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function StatField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`${name}-${label}`} className="text-[11px]">
        {label}
      </Label>
      <Input
        id={`${name}-${label}`}
        name={name}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        defaultValue={defaultValue}
      />
    </div>
  );
}

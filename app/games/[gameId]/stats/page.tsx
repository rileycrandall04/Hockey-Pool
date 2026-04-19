import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { GameStatsEditor } from "@/components/game-stats-editor";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentLeagueContext } from "@/lib/current-league";
import type { ManualGameStat } from "@/lib/types";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Delta helper (same pattern as /games/[gameId]/edit)                 */
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

async function batchUpsertStatsAction(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("game_id"));
  if (!Number.isFinite(gameId)) {
    redirect(
      `/games/${formData.get("game_id") ?? ""}/stats?error=${encodeURIComponent("Invalid game id")}`,
    );
  }

  const rawEntries = String(formData.get("entries") ?? "[]");
  let entries: { player_id: number; goals: number; assists: number; ot_goals: number }[];
  try {
    entries = JSON.parse(rawEntries);
  } catch {
    redirect(`/games/${gameId}/stats?error=${encodeURIComponent("Invalid data")}`);
  }

  // Filter to only rows with actual stats
  entries = entries.filter(
    (e) => e.goals > 0 || e.assists > 0 || e.ot_goals > 0,
  );

  if (entries.length === 0) {
    redirect(`/games/${gameId}/stats?error=${encodeURIComponent("No stats to save.")}`);
  }

  for (const e of entries) {
    if (e.ot_goals > e.goals) {
      redirect(
        `/games/${gameId}/stats?error=${encodeURIComponent(`Player ${e.player_id}: OT goals cannot exceed total goals.`)}`,
      );
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) {
    redirect(
      `/games/${gameId}/stats?error=${encodeURIComponent("Only the app owner can edit game stats.")}`,
    );
  }

  const svc = createServiceClient();

  // Fetch all existing manual stats for this game to compute deltas
  const { data: existingRows } = await svc
    .from("manual_game_stats")
    .select("player_id, goals, assists, ot_goals")
    .eq("game_id", gameId);
  const prevByPlayer = new Map<number, StatsTriple>();
  for (const r of existingRows ?? []) {
    prevByPlayer.set(r.player_id, {
      goals: r.goals,
      assists: r.assists,
      ot_goals: r.ot_goals,
    });
  }

  // Fetch game to know which team each player belongs to
  const { data: gameRow } = await svc
    .from("playoff_games")
    .select("away_abbrev, home_abbrev")
    .eq("game_id", gameId)
    .maybeSingle();
  // Build player → nhl_team_id lookup for score tallying
  const allPlayerIds = entries.map((e) => e.player_id);
  const { data: playerTeamRows } = await svc
    .from("players")
    .select("id, nhl_team_id")
    .in("id", allPlayerIds.length > 0 ? allPlayerIds : [-1]);
  const playerNhlTeam = new Map<number, number>();
  for (const p of playerTeamRows ?? []) {
    playerNhlTeam.set(p.id, p.nhl_team_id);
  }
  // Resolve abbrev → nhl_team_id
  const abbrevs = [gameRow?.away_abbrev, gameRow?.home_abbrev].filter(Boolean) as string[];
  const { data: nhlTeamLookup } = await svc
    .from("nhl_teams")
    .select("id, abbrev")
    .in("abbrev", abbrevs.length > 0 ? abbrevs : ["---"]);
  const awayNhlId = nhlTeamLookup?.find((t) => t.abbrev === gameRow?.away_abbrev)?.id;
  const homeNhlId = nhlTeamLookup?.find((t) => t.abbrev === gameRow?.home_abbrev)?.id;

  let savedCount = 0;
  for (const e of entries) {
    const prev = prevByPlayer.get(e.player_id) ?? { goals: 0, assists: 0, ot_goals: 0 };
    const delta: StatsTriple = {
      goals: e.goals - prev.goals,
      assists: e.assists - prev.assists,
      ot_goals: e.ot_goals - prev.ot_goals,
    };

    const deltaError = await applyPlayerStatsDelta(svc, e.player_id, delta);
    if (deltaError) {
      redirect(
        `/games/${gameId}/stats?error=${encodeURIComponent(`player ${e.player_id}: ${deltaError}`)}&success=${encodeURIComponent(`Saved ${savedCount} entries before error.`)}`,
      );
    }

    const { error: upsertError } = await svc.from("manual_game_stats").upsert(
      {
        game_id: gameId,
        player_id: e.player_id,
        goals: e.goals,
        assists: e.assists,
        ot_goals: e.ot_goals,
        entered_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "game_id,player_id" },
    );
    if (upsertError) {
      await applyPlayerStatsDelta(svc, e.player_id, {
        goals: -delta.goals,
        assists: -delta.assists,
        ot_goals: -delta.ot_goals,
      });
      redirect(
        `/games/${gameId}/stats?error=${encodeURIComponent(`upsert player ${e.player_id}: ${upsertError.message}`)}&success=${encodeURIComponent(`Saved ${savedCount} entries before error.`)}`,
      );
    }
    savedCount++;
  }

  // Auto-compute game scores from all manual stats for this game
  if (awayNhlId != null && homeNhlId != null) {
    const { data: allStats } = await svc
      .from("manual_game_stats")
      .select("player_id, goals")
      .eq("game_id", gameId);
    let awayGoals = 0;
    let homeGoals = 0;
    for (const s of allStats ?? []) {
      const teamId = playerNhlTeam.get(s.player_id);
      if (teamId === awayNhlId) awayGoals += s.goals;
      else if (teamId === homeNhlId) homeGoals += s.goals;
    }
    await svc
      .from("playoff_games")
      .update({
        away_score: awayGoals,
        home_score: homeGoals,
        updated_at: new Date().toISOString(),
      })
      .eq("game_id", gameId);
  }

  revalidatePath(`/games/${gameId}/stats`);
  redirect(
    `/games/${gameId}/stats?success=${encodeURIComponent(`Saved ${savedCount} player${savedCount === 1 ? "" : "s"}.`)}`,
  );
}

async function deleteStatsAction(formData: FormData) {
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
      `/games/${gameId}/stats?error=${encodeURIComponent("Only the app owner can edit game stats.")}`,
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
    redirect(`/games/${gameId}/stats?error=${encodeURIComponent("Row not found")}`);
  }

  const deltaError = await applyPlayerStatsDelta(svc, playerId, {
    goals: -prev.goals,
    assists: -prev.assists,
    ot_goals: -prev.ot_goals,
  });
  if (deltaError) {
    redirect(
      `/games/${gameId}/stats?error=${encodeURIComponent(`player_stats rollback: ${deltaError}`)}`,
    );
  }

  const { error: deleteError } = await svc
    .from("manual_game_stats")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", playerId);
  if (deleteError) {
    redirect(
      `/games/${gameId}/stats?error=${encodeURIComponent(`manual_game_stats delete: ${deleteError.message}`)}`,
    );
  }

  revalidatePath(`/games/${gameId}/stats`);
  redirect(
    `/games/${gameId}/stats?success=${encodeURIComponent("Entry removed")}`,
  );
}

async function markFinalAction(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("game_id"));
  const newState = String(formData.get("game_state") ?? "FINAL");
  if (!Number.isFinite(gameId)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect(`/games/${gameId}/stats`);

  const svc = createServiceClient();
  await svc
    .from("playoff_games")
    .update({
      game_state: newState,
      updated_at: new Date().toISOString(),
    })
    .eq("game_id", gameId);

  // Recompute series wins from all FINAL games in this series
  const { data: game } = await svc
    .from("playoff_games")
    .select("series_letter")
    .eq("game_id", gameId)
    .single();

  if (game) {
    const { data: series } = await svc
      .from("playoff_series")
      .select("top_seed_abbrev, bottom_seed_abbrev, needed_to_win")
      .eq("series_letter", game.series_letter)
      .single();

    if (series) {
      const { data: finalGames } = await svc
        .from("playoff_games")
        .select("away_abbrev, home_abbrev, away_score, home_score")
        .eq("series_letter", game.series_letter)
        .eq("game_state", "FINAL");

      let topWins = 0;
      let bottomWins = 0;
      for (const g of finalGames ?? []) {
        const awayWon = (g.away_score ?? 0) > (g.home_score ?? 0);
        const winner = awayWon ? g.away_abbrev : g.home_abbrev;
        if (winner === series.top_seed_abbrev) topWins++;
        else if (winner === series.bottom_seed_abbrev) bottomWins++;
      }

      const winningTeam =
        topWins >= series.needed_to_win
          ? series.top_seed_abbrev
          : bottomWins >= series.needed_to_win
            ? series.bottom_seed_abbrev
            : null;

      await svc
        .from("playoff_series")
        .update({
          top_seed_wins: topWins,
          bottom_seed_wins: bottomWins,
          winning_team_abbrev: winningTeam,
          updated_at: new Date().toISOString(),
        })
        .eq("series_letter", game.series_letter);
    }
  }

  revalidatePath(`/games/${gameId}/stats`);
  redirect(
    `/games/${gameId}/stats?success=${encodeURIComponent(`Game marked as ${newState}.`)}`,
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function GameStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{
    success?: string;
    error?: string;
    from?: string;
    league?: string;
  }>;
}) {
  const { gameId: gameIdParam } = await params;
  const gameId = Number(gameIdParam);
  if (!Number.isFinite(gameId)) notFound();
  const { success, error, from, league: leagueParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!isAppOwner(user.email)) {
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

  // Fetch game from playoff_games
  const { data: game } = await supabase
    .from("playoff_games")
    .select("*")
    .eq("game_id", gameId)
    .maybeSingle();
  if (!game) notFound();

  // Get team IDs from nhl_teams
  const teamAbbrevs = [game.away_abbrev, game.home_abbrev].filter(Boolean);
  const { data: teamRows } = await supabase
    .from("nhl_teams")
    .select("id, abbrev, name")
    .in("abbrev", teamAbbrevs.length > 0 ? teamAbbrevs : ["---"]);
  const teams = teamRows ?? [];

  const awayTeamRow = teams.find((t) => t.abbrev === game.away_abbrev);
  const homeTeamRow = teams.find((t) => t.abbrev === game.home_abbrev);

  // Fetch players for both teams
  const teamIds = teams.map((t) => t.id);
  const { data: playerRows } = await supabase
    .from("players")
    .select("id, full_name, position, nhl_team_id")
    .in("nhl_team_id", teamIds.length > 0 ? teamIds : [-1])
    .eq("active", true)
    .order("full_name", { ascending: true });
  const players = playerRows ?? [];

  const awayPlayers = players
    .filter((p) => awayTeamRow && p.nhl_team_id === awayTeamRow.id)
    .map((p) => ({ id: p.id, full_name: p.full_name, position: p.position }));
  const homePlayers = players
    .filter((p) => homeTeamRow && p.nhl_team_id === homeTeamRow.id)
    .map((p) => ({ id: p.id, full_name: p.full_name, position: p.position }));

  // Fetch existing manual stats for this game
  const { data: statRows } = await supabase
    .from("manual_game_stats")
    .select("*")
    .eq("game_id", gameId);
  const existingStats = (statRows ?? []) as ManualGameStat[];

  const leagueCtx = await getCurrentLeagueContext(user.id);

  // Only query unresolved stat conflicts for the app owner
  let alertCount = 0;
  {
    const svcAlerts = createServiceClient();
    const { count } = await svcAlerts
      .from("stat_conflicts")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false);
    alertCount = count ?? 0;
  }

  // Build game header
  const awayLabel = game.away_abbrev ?? "?";
  const homeLabel = game.home_abbrev ?? "?";
  const scoreStr =
    game.away_score != null && game.home_score != null
      ? `${game.away_score}–${game.home_score}`
      : "vs";
  const gameTitle = `${awayLabel} ${scoreStr} ${homeLabel}`;

  // Determine back link
  const backHref =
    from === "bracket" && leagueParam
      ? `/leagues/${leagueParam}/bracket`
      : leagueCtx.leagueId
        ? `/leagues/${leagueCtx.leagueId}/bracket`
        : "/dashboard";

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueCtx.leagueId}
        draftStatus={leagueCtx.draftStatus}
        isCommissioner={leagueCtx.isCommissioner}
        isOwner
        alertCount={alertCount}
      />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href={backHref}
          className="text-sm text-ice-400 hover:underline"
        >
          &larr; Back to bracket
        </Link>

        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
              {gameTitle}
            </h1>
            <p className="text-xs text-ice-400">
              {game.game_date ?? "No date"} &middot;{" "}
              Game {game.game_number ?? "?"} &middot;{" "}
              Series {game.series_letter} &middot;{" "}
              <span className="uppercase">{game.game_state ?? "FUT"}</span>
            </p>
          </div>
          <form action={markFinalAction} className="flex-shrink-0">
            <input type="hidden" name="game_id" value={gameId} />
            {game.game_state === "FINAL" ? (
              <>
                <input type="hidden" name="game_state" value="LIVE" />
                <Button size="sm" variant="secondary" type="submit">
                  Reopen game
                </Button>
              </>
            ) : (
              <>
                <input type="hidden" name="game_state" value="FINAL" />
                <Button size="sm" variant="primary" type="submit">
                  Mark as Final
                </Button>
              </>
            )}
          </form>
        </header>

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

        <Card>
          <CardHeader>
            <CardTitle>
              Game stats
              <span className="ml-2 text-xs font-normal text-ice-400">
                {existingStats.length} entries
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-[11px] text-ice-500">
              Enter goals, assists, and OT goals per player. Saving
              applies the delta to cumulative player stats. OT goals
              count inside the goals total.
            </p>
            <GameStatsEditor
              gameId={gameId}
              awayTeam={{
                abbrev: awayLabel,
                name: awayTeamRow?.name ?? awayLabel,
                players: awayPlayers,
              }}
              homeTeam={{
                abbrev: homeLabel,
                name: homeTeamRow?.name ?? homeLabel,
                players: homePlayers,
              }}
              existingStats={existingStats}
              batchUpsertAction={batchUpsertStatsAction}
              deleteAction={deleteStatsAction}
            />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

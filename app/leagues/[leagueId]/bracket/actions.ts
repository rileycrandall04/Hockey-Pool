"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { recomputeSeriesWinsForGame } from "@/lib/recompute-series-wins";
import { mdtToUtcIso } from "./time-helpers";

/* ------------------------------------------------------------------ */
/*  Auth helper                                                        */
/* ------------------------------------------------------------------ */

async function assertOwner(leagueId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect(`/leagues/${leagueId}/bracket`);
  return user;
}

/* ------------------------------------------------------------------ */
/*  Server actions — Games                                             */
/* ------------------------------------------------------------------ */

export async function createGameAction(formData: FormData) {
  const leagueId = String(formData.get("league_id") ?? "");
  await assertOwner(leagueId);

  const seriesLetter = String(formData.get("series_letter") ?? "").trim();
  const gameNumber = Number(formData.get("game_number")) || null;
  const startTimeRaw = String(formData.get("start_time_utc") ?? "").trim();
  const gameDateRaw = String(formData.get("game_date") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim() || null;
  const awayAbbrev = String(formData.get("away_abbrev") ?? "").trim() || null;
  const homeAbbrev = String(formData.get("home_abbrev") ?? "").trim() || null;
  const gameState =
    String(formData.get("game_state") ?? "FUT").trim() || "FUT";

  if (!seriesLetter) {
    redirect(
      `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent("Series letter is required.")}`,
    );
  }

  // Derive game_date from start time if not provided
  const startTimeUtc = startTimeRaw ? mdtToUtcIso(startTimeRaw) : null;
  let gameDate = gameDateRaw || null;
  if (!gameDate && startTimeRaw) {
    // Extract YYYY-MM-DD from the local MDT input (YYYY-MM-DDTHH:mm)
    gameDate = startTimeRaw.slice(0, 10);
  }

  const svc = createServiceClient();

  // Check for an existing game in the same series with the same game
  // number (or same team pair) to avoid creating duplicates when the
  // cron has already synced this game from the NHL API.
  if (gameNumber != null) {
    const { data: existing } = await svc
      .from("playoff_games")
      .select("game_id")
      .eq("series_letter", seriesLetter)
      .eq("game_number", gameNumber)
      .limit(1);
    if (existing && existing.length > 0) {
      redirect(
        `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent(`Game ${gameNumber} already exists in series ${seriesLetter}.`)}`,
      );
    }
  }

  const gameId = Date.now();
  const { error } = await svc.from("playoff_games").insert({
    game_id: gameId,
    series_letter: seriesLetter,
    game_number: gameNumber,
    start_time_utc: startTimeUtc,
    game_date: gameDate,
    venue,
    away_abbrev: awayAbbrev,
    home_abbrev: homeAbbrev,
    game_state: gameState,
    tv_broadcasts: [],
    updated_at: new Date().toISOString(),
  });

  revalidatePath(`/leagues/${leagueId}/bracket`);
  revalidatePath("/", "layout");
  if (error) {
    redirect(
      `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(
    `/leagues/${leagueId}/bracket?game_success=${encodeURIComponent(`Game ${gameNumber ?? ""} added to series ${seriesLetter}.`)}`,
  );
}

export async function updateGameAction(formData: FormData) {
  const leagueId = String(formData.get("league_id") ?? "");
  await assertOwner(leagueId);

  const gameId = Number(formData.get("game_id"));
  if (!Number.isFinite(gameId)) {
    redirect(
      `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent("Invalid game id.")}`,
    );
  }

  const startTimeRaw = String(formData.get("start_time_utc") ?? "").trim();
  const venue = String(formData.get("venue") ?? "").trim() || null;
  const awayAbbrev = String(formData.get("away_abbrev") ?? "").trim();
  const homeAbbrev = String(formData.get("home_abbrev") ?? "").trim();
  const awayScore = String(formData.get("away_score") ?? "").trim();
  const homeScore = String(formData.get("home_score") ?? "").trim();
  const gameState =
    String(formData.get("game_state") ?? "").trim() || undefined;

  const svc = createServiceClient();

  // Build update payload
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (startTimeRaw) {
    updates.start_time_utc = mdtToUtcIso(startTimeRaw);
    // Also update game_date from the start time if it was previously null
    updates.game_date = startTimeRaw.slice(0, 10);
  }
  if (venue !== null) updates.venue = venue;
  if (awayAbbrev) updates.away_abbrev = awayAbbrev;
  if (homeAbbrev) updates.home_abbrev = homeAbbrev;
  if (awayScore !== "") updates.away_score = Number(awayScore);
  if (homeScore !== "") updates.home_score = Number(homeScore);
  if (gameState) updates.game_state = gameState;

  const { error } = await svc
    .from("playoff_games")
    .update(updates)
    .eq("game_id", gameId);

  // Score or state edits both can change a series' standing — recompute
  // unconditionally so a 1-0 → 0-3 score swap on an already-FINAL game
  // also re-tallies wins.
  await recomputeSeriesWinsForGame(svc, gameId);

  revalidatePath(`/leagues/${leagueId}/bracket`);
  revalidatePath("/", "layout");
  if (error) {
    redirect(
      `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(
    `/leagues/${leagueId}/bracket?game_success=${encodeURIComponent(`Game ${gameId} updated.`)}`,
  );
}

export async function deleteGameAction(formData: FormData) {
  const leagueId = String(formData.get("league_id") ?? "");
  await assertOwner(leagueId);

  const gameId = Number(formData.get("game_id"));
  if (!Number.isFinite(gameId)) {
    redirect(
      `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent("Invalid game id.")}`,
    );
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("playoff_games")
    .delete()
    .eq("game_id", gameId);

  revalidatePath(`/leagues/${leagueId}/bracket`);
  revalidatePath("/", "layout");
  if (error) {
    redirect(
      `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(
    `/leagues/${leagueId}/bracket?game_success=${encodeURIComponent("Game deleted.")}`,
  );
}

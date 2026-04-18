"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
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

  const gameId = Date.now();

  const svc = createServiceClient();
  const { error } = await svc.from("playoff_games").insert({
    game_id: gameId,
    series_letter: seriesLetter,
    game_number: gameNumber,
    start_time_utc: startTimeRaw ? mdtToUtcIso(startTimeRaw) : null,
    game_date: gameDateRaw || null,
    venue,
    away_abbrev: awayAbbrev,
    home_abbrev: homeAbbrev,
    game_state: gameState,
    tv_broadcasts: [],
    updated_at: new Date().toISOString(),
  });

  revalidatePath(`/leagues/${leagueId}/bracket`);
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
  const awayScore = String(formData.get("away_score") ?? "").trim();
  const homeScore = String(formData.get("home_score") ?? "").trim();
  const gameState =
    String(formData.get("game_state") ?? "").trim() || undefined;

  const svc = createServiceClient();
  const { error } = await svc
    .from("playoff_games")
    .update({
      ...(startTimeRaw
        ? { start_time_utc: mdtToUtcIso(startTimeRaw) }
        : {}),
      ...(venue !== null ? { venue } : {}),
      ...(awayScore !== "" ? { away_score: Number(awayScore) } : {}),
      ...(homeScore !== "" ? { home_score: Number(homeScore) } : {}),
      ...(gameState ? { game_state: gameState } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("game_id", gameId);

  revalidatePath(`/leagues/${leagueId}/bracket`);
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
  if (error) {
    redirect(
      `/leagues/${leagueId}/bracket?game_error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(
    `/leagues/${leagueId}/bracket?game_success=${encodeURIComponent("Game deleted.")}`,
  );
}

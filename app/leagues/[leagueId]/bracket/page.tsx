import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { PlayoffBracket } from "@/components/playoff-bracket";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { League, PlayoffGame, PlayoffSeries } from "@/lib/types";

export const dynamic = "force-dynamic";

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
/*  Server actions — Series                                            */
/* ------------------------------------------------------------------ */

async function upsertSeriesAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  await assertOwner(leagueId);

  const seriesLetter = String(formData.get("series_letter") ?? "")
    .trim()
    .toUpperCase();
  const round = Number(formData.get("round"));
  const season = String(formData.get("season") ?? "20242025").trim();
  const topAbbrev = String(formData.get("top_seed_abbrev") ?? "").trim();
  const bottomAbbrev = String(formData.get("bottom_seed_abbrev") ?? "").trim();
  const seriesTitle = String(formData.get("series_title") ?? "").trim();
  const neededToWin = Number(formData.get("needed_to_win")) || 4;
  const sortOrder = Number(formData.get("sort_order")) || 0;

  if (!seriesLetter || !round) {
    redirect(
      `/leagues/${leagueId}/bracket?series_error=${encodeURIComponent("Series letter and round are required.")}`,
    );
  }

  const svc = createServiceClient();

  // Look up team names + logos from nhl_teams
  const { data: teams } = await svc
    .from("nhl_teams")
    .select("abbrev, name, logo_url")
    .in("abbrev", [topAbbrev, bottomAbbrev].filter(Boolean));
  const teamMap = new Map(
    (teams ?? []).map((t) => [t.abbrev, { name: t.name, logo: t.logo_url }]),
  );

  const { error } = await svc.from("playoff_series").upsert(
    {
      series_letter: seriesLetter,
      round,
      season,
      top_seed_abbrev: topAbbrev || null,
      top_seed_name: teamMap.get(topAbbrev)?.name ?? null,
      top_seed_logo: teamMap.get(topAbbrev)?.logo ?? null,
      top_seed_wins: 0,
      bottom_seed_abbrev: bottomAbbrev || null,
      bottom_seed_name: teamMap.get(bottomAbbrev)?.name ?? null,
      bottom_seed_logo: teamMap.get(bottomAbbrev)?.logo ?? null,
      bottom_seed_wins: 0,
      series_title: seriesTitle || null,
      needed_to_win: neededToWin,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "series_letter" },
  );

  revalidatePath(`/leagues/${leagueId}/bracket`);
  if (error) {
    redirect(
      `/leagues/${leagueId}/bracket?series_error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(
    `/leagues/${leagueId}/bracket?series_success=${encodeURIComponent(`Series ${seriesLetter} saved.`)}`,
  );
}

async function updateSeriesAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  await assertOwner(leagueId);

  const seriesLetter = String(formData.get("series_letter") ?? "").trim();
  const topWins = Number(formData.get("top_seed_wins")) || 0;
  const bottomWins = Number(formData.get("bottom_seed_wins")) || 0;
  const winnerAbbrev =
    String(formData.get("winning_team_abbrev") ?? "").trim() || null;

  if (!seriesLetter) {
    redirect(
      `/leagues/${leagueId}/bracket?series_error=${encodeURIComponent("Missing series letter.")}`,
    );
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("playoff_series")
    .update({
      top_seed_wins: topWins,
      bottom_seed_wins: bottomWins,
      winning_team_abbrev: winnerAbbrev,
      updated_at: new Date().toISOString(),
    })
    .eq("series_letter", seriesLetter);

  revalidatePath(`/leagues/${leagueId}/bracket`);
  if (error) {
    redirect(
      `/leagues/${leagueId}/bracket?series_error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(
    `/leagues/${leagueId}/bracket?series_success=${encodeURIComponent(`Series ${seriesLetter} updated.`)}`,
  );
}

async function deleteSeriesAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  await assertOwner(leagueId);

  const seriesLetter = String(formData.get("series_letter") ?? "").trim();
  if (!seriesLetter) {
    redirect(
      `/leagues/${leagueId}/bracket?series_error=${encodeURIComponent("Missing series letter.")}`,
    );
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("playoff_series")
    .delete()
    .eq("series_letter", seriesLetter);

  revalidatePath(`/leagues/${leagueId}/bracket`);
  if (error) {
    redirect(
      `/leagues/${leagueId}/bracket?series_error=${encodeURIComponent(error.message)}`,
    );
  }
  redirect(
    `/leagues/${leagueId}/bracket?series_success=${encodeURIComponent(`Series ${seriesLetter} deleted (games cascade-removed).`)}`,
  );
}

/* ------------------------------------------------------------------ */
/*  Server actions — Games                                             */
/* ------------------------------------------------------------------ */

async function createGameAction(formData: FormData) {
  "use server";
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

  // Synthetic game_id — use Date.now() to avoid collision with real NHL ids (2024030111 range)
  const gameId = Date.now();

  const svc = createServiceClient();
  const { error } = await svc.from("playoff_games").insert({
    game_id: gameId,
    series_letter: seriesLetter,
    game_number: gameNumber,
    start_time_utc: startTimeRaw ? new Date(startTimeRaw).toISOString() : null,
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

async function updateGameAction(formData: FormData) {
  "use server";
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
        ? { start_time_utc: new Date(startTimeRaw).toISOString() }
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

async function deleteGameAction(formData: FormData) {
  "use server";
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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function LeagueBracketPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{
    series_success?: string;
    series_error?: string;
    game_success?: string;
    game_error?: string;
  }>;
}) {
  const { leagueId } = await params;
  const {
    series_success,
    series_error,
    game_success,
    game_error,
  } = await searchParams;

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

  const isCommissioner = league.commissioner_id === user.id;
  const isOwner = isAppOwner(user.email);

  const { data: seriesRows } = await supabase
    .from("playoff_series")
    .select("*")
    .order("round", { ascending: true })
    .order("sort_order", { ascending: true });
  const { data: gameRows } = await supabase
    .from("playoff_games")
    .select("*")
    .order("start_time_utc", { ascending: true });

  const series = (seriesRows ?? []) as PlayoffSeries[];
  const games = (gameRows ?? []) as PlayoffGame[];

  // Fetch nhl_teams for dropdown options (only needed for owner)
  let nhlTeams: { abbrev: string; name: string }[] = [];
  if (isOwner) {
    const { data: teamRows } = await supabase
      .from("nhl_teams")
      .select("abbrev, name")
      .order("abbrev", { ascending: true });
    nhlTeams = (teamRows ?? []) as { abbrev: string; name: string }[];
  }

  return (
    <>
      <NavBar
        displayName={profile?.display_name ?? user.email ?? "Player"}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
        isOwner={isOwner}
      />
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-ice-50 sm:text-3xl">
            Stanley Cup Bracket
          </h1>
          <span className="text-[10px] uppercase tracking-wider text-ice-500">
            Updates 6am ET
          </span>
        </div>
        {series.length === 0 && (
          <p className="mb-4 rounded-md border border-dashed border-puck-border bg-puck-card/60 px-3 py-2 text-xs text-ice-400">
            The bracket hasn&rsquo;t been populated yet. Matchups,
            series scores, and broadcast info will appear here after
            the next nightly sync.
          </p>
        )}
        <PlayoffBracket series={series} games={games} />

        {/* -------------------------------------------------------- */}
        {/*  Owner-only management section                           */}
        {/* -------------------------------------------------------- */}
        {isOwner && (
          <div className="mt-10 space-y-6">
            <h2 className="text-xl font-bold text-ice-100">
              Bracket management
            </h2>

            {/* ---------- Manage series ---------- */}
            <Card>
              <CardHeader>
                <CardTitle>Manage series</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {series_success && (
                  <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                    {series_success}
                  </div>
                )}
                {series_error && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {series_error}
                  </div>
                )}

                {/* Existing series table */}
                {series.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-puck-border text-[11px] uppercase tracking-wider text-ice-400">
                          <th className="px-2 py-1">Letter</th>
                          <th className="px-2 py-1">Rd</th>
                          <th className="px-2 py-1">Matchup</th>
                          <th className="px-2 py-1">Top W</th>
                          <th className="px-2 py-1">Bot W</th>
                          <th className="px-2 py-1">Winner</th>
                          <th className="px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {series.map((s) => (
                          <tr
                            key={s.series_letter}
                            className="border-b border-puck-border/50"
                          >
                            <td className="px-2 py-2 font-mono font-bold text-ice-100">
                              {s.series_letter}
                            </td>
                            <td className="px-2 py-2 text-ice-300">
                              {s.round}
                            </td>
                            <td className="px-2 py-2 text-ice-200">
                              {s.top_seed_abbrev ?? "TBD"} vs{" "}
                              {s.bottom_seed_abbrev ?? "TBD"}
                            </td>
                            <td colSpan={4} className="px-2 py-2">
                              <form
                                action={updateSeriesAction}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <input
                                  type="hidden"
                                  name="league_id"
                                  value={leagueId}
                                />
                                <input
                                  type="hidden"
                                  name="series_letter"
                                  value={s.series_letter}
                                />
                                <Input
                                  name="top_seed_wins"
                                  type="number"
                                  min={0}
                                  max={4}
                                  defaultValue={s.top_seed_wins}
                                  className="w-14"
                                />
                                <Input
                                  name="bottom_seed_wins"
                                  type="number"
                                  min={0}
                                  max={4}
                                  defaultValue={s.bottom_seed_wins}
                                  className="w-14"
                                />
                                <Input
                                  name="winning_team_abbrev"
                                  type="text"
                                  placeholder="Winner"
                                  defaultValue={
                                    s.winning_team_abbrev ?? ""
                                  }
                                  className="w-20"
                                />
                                <Button size="sm" type="submit">
                                  Save
                                </Button>
                              </form>
                              <form
                                action={deleteSeriesAction}
                                className="mt-1 inline-block"
                              >
                                <input
                                  type="hidden"
                                  name="league_id"
                                  value={leagueId}
                                />
                                <input
                                  type="hidden"
                                  name="series_letter"
                                  value={s.series_letter}
                                />
                                <Button
                                  size="sm"
                                  variant="danger"
                                  type="submit"
                                >
                                  Delete
                                </Button>
                              </form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Add series form */}
                <details className="rounded-md border border-puck-border bg-puck-bg/40 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-ice-200">
                    Add / overwrite series
                  </summary>
                  <form
                    action={upsertSeriesAction}
                    className="mt-3 space-y-3"
                  >
                    <input
                      type="hidden"
                      name="league_id"
                      value={leagueId}
                    />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label htmlFor="new-series-letter">
                          Series letter
                        </Label>
                        <Input
                          id="new-series-letter"
                          name="series_letter"
                          maxLength={1}
                          required
                          placeholder="A"
                          className="uppercase"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-series-round">Round</Label>
                        <Input
                          id="new-series-round"
                          name="round"
                          type="number"
                          min={1}
                          max={4}
                          required
                          placeholder="1"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-series-top">Top seed</Label>
                        <Select
                          id="new-series-top"
                          name="top_seed_abbrev"
                        >
                          <option value="">— select —</option>
                          {nhlTeams.map((t) => (
                            <option key={t.abbrev} value={t.abbrev}>
                              {t.abbrev} — {t.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-series-bottom">
                          Bottom seed
                        </Label>
                        <Select
                          id="new-series-bottom"
                          name="bottom_seed_abbrev"
                        >
                          <option value="">— select —</option>
                          {nhlTeams.map((t) => (
                            <option key={t.abbrev} value={t.abbrev}>
                              {t.abbrev} — {t.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label htmlFor="new-series-title">
                          Series title
                        </Label>
                        <Input
                          id="new-series-title"
                          name="series_title"
                          placeholder="First Round"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-series-sort">Sort order</Label>
                        <Input
                          id="new-series-sort"
                          name="sort_order"
                          type="number"
                          defaultValue={0}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-series-ntw">
                          Needed to win
                        </Label>
                        <Input
                          id="new-series-ntw"
                          name="needed_to_win"
                          type="number"
                          min={1}
                          defaultValue={4}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-series-season">Season</Label>
                        <Input
                          id="new-series-season"
                          name="season"
                          defaultValue="20242025"
                        />
                      </div>
                    </div>
                    <Button type="submit">Add series</Button>
                  </form>
                  <p className="mt-2 text-[10px] text-ice-500">
                    Re-submitting a series letter will overwrite it. The
                    nightly sync may also update these.
                  </p>
                </details>
              </CardContent>
            </Card>

            {/* ---------- Manage games ---------- */}
            <Card>
              <CardHeader>
                <CardTitle>Manage games</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {game_success && (
                  <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                    {game_success}
                  </div>
                )}
                {game_error && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {game_error}
                  </div>
                )}

                {/* Existing games grouped by series */}
                {series.map((s) => {
                  const seriesGames = games.filter(
                    (g) => g.series_letter === s.series_letter,
                  );
                  if (seriesGames.length === 0) return null;
                  return (
                    <details
                      key={s.series_letter}
                      className="rounded-md border border-puck-border bg-puck-bg/40 p-3"
                    >
                      <summary className="cursor-pointer text-sm font-semibold text-ice-200">
                        Series {s.series_letter} &mdash;{" "}
                        {s.top_seed_abbrev ?? "TBD"} vs{" "}
                        {s.bottom_seed_abbrev ?? "TBD"} ({seriesGames.length}{" "}
                        game{seriesGames.length !== 1 ? "s" : ""})
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {seriesGames.map((g) => (
                          <li
                            key={g.game_id}
                            className="rounded border border-puck-border/50 bg-puck-bg/60 p-2"
                          >
                            <div className="mb-1 flex items-baseline gap-2 text-xs text-ice-300">
                              <span className="font-mono font-bold text-ice-100">
                                G{g.game_number ?? "?"}
                              </span>
                              <span>{g.game_state ?? "FUT"}</span>
                              <span>
                                {g.game_date ?? "no date"}
                              </span>
                              <span>
                                {g.away_abbrev ?? "?"} @{" "}
                                {g.home_abbrev ?? "?"}
                              </span>
                              {(g.away_score != null ||
                                g.home_score != null) && (
                                <span className="font-bold text-ice-100">
                                  {g.away_score ?? 0}–{g.home_score ?? 0}
                                </span>
                              )}
                            </div>
                            <form
                              action={updateGameAction}
                              className="flex flex-wrap items-end gap-2"
                            >
                              <input
                                type="hidden"
                                name="league_id"
                                value={leagueId}
                              />
                              <input
                                type="hidden"
                                name="game_id"
                                value={g.game_id}
                              />
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">
                                  Start (UTC)
                                </Label>
                                <Input
                                  name="start_time_utc"
                                  type="datetime-local"
                                  defaultValue={
                                    g.start_time_utc
                                      ? g.start_time_utc.slice(0, 16)
                                      : ""
                                  }
                                  className="w-44 text-xs"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">
                                  Venue
                                </Label>
                                <Input
                                  name="venue"
                                  defaultValue={g.venue ?? ""}
                                  className="w-28 text-xs"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">
                                  Away
                                </Label>
                                <Input
                                  name="away_score"
                                  type="number"
                                  min={0}
                                  defaultValue={g.away_score ?? ""}
                                  className="w-14 text-xs"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">
                                  Home
                                </Label>
                                <Input
                                  name="home_score"
                                  type="number"
                                  min={0}
                                  defaultValue={g.home_score ?? ""}
                                  className="w-14 text-xs"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">
                                  State
                                </Label>
                                <Select
                                  name="game_state"
                                  defaultValue={g.game_state ?? "FUT"}
                                  className="w-24 text-xs"
                                >
                                  <option value="FUT">FUT</option>
                                  <option value="PRE">PRE</option>
                                  <option value="LIVE">LIVE</option>
                                  <option value="FINAL">FINAL</option>
                                  <option value="OFF">OFF</option>
                                </Select>
                              </div>
                              <Button size="sm" type="submit">
                                Save
                              </Button>
                            </form>
                            <form
                              action={deleteGameAction}
                              className="mt-1 inline-block"
                            >
                              <input
                                type="hidden"
                                name="league_id"
                                value={leagueId}
                              />
                              <input
                                type="hidden"
                                name="game_id"
                                value={g.game_id}
                              />
                              <Button
                                size="sm"
                                variant="danger"
                                type="submit"
                              >
                                Delete
                              </Button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })}

                {/* Add game form */}
                <details className="rounded-md border border-puck-border bg-puck-bg/40 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-ice-200">
                    Add game
                  </summary>
                  <form
                    action={createGameAction}
                    className="mt-3 space-y-3"
                  >
                    <input
                      type="hidden"
                      name="league_id"
                      value={leagueId}
                    />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label htmlFor="new-game-series">Series</Label>
                        <Select
                          id="new-game-series"
                          name="series_letter"
                          required
                        >
                          <option value="">— select —</option>
                          {series.map((s) => (
                            <option
                              key={s.series_letter}
                              value={s.series_letter}
                            >
                              {s.series_letter} —{" "}
                              {s.top_seed_abbrev ?? "?"} vs{" "}
                              {s.bottom_seed_abbrev ?? "?"}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-game-number">
                          Game #
                        </Label>
                        <Input
                          id="new-game-number"
                          name="game_number"
                          type="number"
                          min={1}
                          max={7}
                          placeholder="1"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-game-start">
                          Start time
                        </Label>
                        <Input
                          id="new-game-start"
                          name="start_time_utc"
                          type="datetime-local"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-game-date">Game date</Label>
                        <Input
                          id="new-game-date"
                          name="game_date"
                          type="date"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label htmlFor="new-game-away">Away team</Label>
                        <Select
                          id="new-game-away"
                          name="away_abbrev"
                        >
                          <option value="">— select —</option>
                          {nhlTeams.map((t) => (
                            <option key={t.abbrev} value={t.abbrev}>
                              {t.abbrev}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-game-home">Home team</Label>
                        <Select
                          id="new-game-home"
                          name="home_abbrev"
                        >
                          <option value="">— select —</option>
                          {nhlTeams.map((t) => (
                            <option key={t.abbrev} value={t.abbrev}>
                              {t.abbrev}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-game-venue">Venue</Label>
                        <Input
                          id="new-game-venue"
                          name="venue"
                          placeholder="Arena name"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="new-game-state">State</Label>
                        <Select
                          id="new-game-state"
                          name="game_state"
                          defaultValue="FUT"
                        >
                          <option value="FUT">FUT</option>
                          <option value="PRE">PRE</option>
                          <option value="LIVE">LIVE</option>
                          <option value="FINAL">FINAL</option>
                          <option value="OFF">OFF</option>
                        </Select>
                      </div>
                    </div>
                    <Button type="submit">Add game</Button>
                  </form>
                </details>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </>
  );
}

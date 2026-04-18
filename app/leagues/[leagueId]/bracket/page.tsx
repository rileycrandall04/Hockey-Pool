import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLeagueForMember } from "@/lib/league-access";
import { isAppOwner } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { PlayoffBracket, BRACKET_SLOTS } from "@/components/playoff-bracket";
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
/*  Bracket slot labels                                                */
/* ------------------------------------------------------------------ */

const CONF_LABELS: Record<string, string> = { EAST: "East", WEST: "West", FINAL: "" };
const ROUND_LABELS: Record<number, string> = { 1: "R1", 2: "R2", 3: "CF", 4: "Final" };
const slotLabel = new Map(
  BRACKET_SLOTS.map((s) => [
    s.letter,
    s.conference === "FINAL"
      ? "Final"
      : `${CONF_LABELS[s.conference]} ${ROUND_LABELS[s.round]}`,
  ]),
);

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

        {/* Flash messages for game actions */}
        {game_success && (
          <div className="mb-4 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            {game_success}
          </div>
        )}
        {game_error && (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {game_error}
          </div>
        )}

        <PlayoffBracket
          series={series}
          games={games}
          isOwner={isOwner}
          leagueId={leagueId}
          nhlTeams={nhlTeams}
        />

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
                            id={`manage-series-${s.series_letter}`}
                            className="border-b border-puck-border/50 scroll-mt-20"
                          >
                            <td className="px-2 py-2 font-mono font-bold text-ice-100">
                              {s.series_letter}
                              <span className="ml-1 text-[10px] font-normal text-ice-400">
                                {slotLabel.get(s.series_letter) ?? ""}
                              </span>
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
          </div>
        )}
      </main>
    </>
  );
}

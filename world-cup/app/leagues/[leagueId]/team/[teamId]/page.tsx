import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireLeagueView } from "@/lib/league-access";
import {
  scoreCountry,
  WIN_POINTS,
  DRAW_POINTS,
  LOSS_POINTS,
  GOAL_FOR_POINTS,
  GOAL_AGAINST_POINTS,
  CLEAN_SHEET_POINTS,
  UPSET_POINTS,
  SHOOTOUT_WIN_POINTS,
  SHOOTOUT_LOSS_POINTS,
  ADVANCEMENT_POINTS,
  CHAMPION_POINTS,
  RUNNER_UP_POINTS,
  THIRD_PLACE_POINTS,
} from "@/lib/scoring";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { fmtPoints } from "@/lib/utils";
import type { Country, ScoringMatch } from "@/lib/types";

export const dynamic = "force-dynamic";

async function setOverUnderAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "");
  const raw = String(formData.get("over_under") ?? "").trim();
  const value = raw === "" ? null : Math.round(Number(raw));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS: only the owner (or commissioner) can update the team row.
  await supabase.from("teams").update({ over_under_guess: value }).eq("id", teamId);
  revalidatePath(`/leagues/${leagueId}/team/${teamId}`);
  redirect(`/leagues/${leagueId}/team/${teamId}`);
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ leagueId: string; teamId: string }>;
}) {
  const { leagueId, teamId } = await params;
  const access = await requireLeagueView(leagueId);

  const { league, teams, ownerNames, isCommissioner, displayName, readOnly } = access;
  const team = teams.find((t) => t.id === teamId);
  if (!team) redirect(`/leagues/${leagueId}`);

  const isMine = team.owner_id === access.user.id;
  const svc = createServiceClient();

  const [{ data: pickRows }, { data: countryRows }, { data: matchRows }] = await Promise.all([
    svc.from("draft_picks").select("country_id").eq("league_id", leagueId).eq("team_id", teamId),
    svc.from("countries").select("*"),
    svc.from("matches").select("*"),
  ]);

  const countries = (countryRows ?? []) as Country[];
  const countryById = new Map(countries.map((c) => [c.id, c]));
  const fifaRank = (id: number) => countryById.get(id)?.fifa_rank ?? null;
  const matches = (matchRows ?? []) as ScoringMatch[];

  const myCountryIds = (pickRows ?? []).map((p) => p.country_id as number);
  const scored = myCountryIds.map((id) => ({
    country: countryById.get(id),
    s: scoreCountry(id, matches, fifaRank),
  }));
  const total = scored.reduce((sum, x) => sum + x.s.total, 0);
  const liveTotal = scored.reduce((sum, x) => sum + x.s.provisional_points, 0);

  return (
    <>
      <NavBar
        displayName={displayName}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
        readOnly={readOnly}
      />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-ice-50">{team.name}</h1>
          <p className="text-xs text-ice-400">
            {ownerNames.get(team.owner_id) ?? "Player"} · {fmtPoints(total)} pts
            from {myCountryIds.length} countries
            {liveTotal !== 0 && (
              <span className="ml-1 font-medium text-amber-400">
                · 🔴 {liveTotal > 0 ? "+" : ""}{fmtPoints(liveTotal)} live
              </span>
            )}
          </p>
        </div>

        {scored.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-ice-300">
              No countries drafted yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {scored.map(({ country, s }) =>
              country ? (
                <div
                  key={country.id}
                  className="rounded-md border border-puck-border bg-puck-card p-3"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <Link
                      href={`/leagues/${leagueId}/country/${country.id}`}
                      className="inline-flex items-center gap-2 font-semibold text-ice-50 hover:underline"
                    >
                      <Flag code={country.code} url={country.flag_url} />
                      {country.name}{" "}
                      <span className="text-xs text-ice-500">
                        {country.group_letter ? `Grp ${country.group_letter}` : ""}
                        {country.fifa_rank ? ` · #${country.fifa_rank}` : ""}
                      </span>
                    </Link>
                    <span className="font-semibold text-ice-50">
                      {fmtPoints(s.total)}
                      {s.provisional_points !== 0 && (
                        <span className="ml-1 text-[10px] font-medium text-amber-400">🔴</span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ice-400">
                    <Stat label="Result" parts={s.contributions.result} />
                    <Stat label="Goals for" parts={s.contributions.goals_for} />
                    <Stat label="Goals against" parts={s.contributions.goals_against} />
                    <Stat label="Clean sheet" parts={s.contributions.clean_sheet} />
                    <Stat label="Upset" parts={s.contributions.upset} />
                    <Stat label="Advancement" parts={s.contributions.advancement} />
                    <Stat label="Champion" parts={s.contributions.champion} />
                    <Stat label="Runner-up" parts={s.contributions.runner_up} />
                    <Stat label="Third place" parts={s.contributions.third_place} />
                  </div>
                </div>
              ) : null,
            )}
          </div>
        )}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>How points are scored</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-xs">
              {SCORING_LEGEND.map(([label, desc]) => (
                <div key={label} className="flex flex-wrap gap-x-2">
                  <dt className="w-28 shrink-0 font-medium text-ice-200">{label}</dt>
                  <dd className="flex-1 text-ice-400">{desc}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] text-ice-500">
              Semifinal &amp; final match points (result, goals, clean sheet)
              count ×1.5. A team also earns the Golden Boot bonus for its owner
              if it has the tournament&rsquo;s top scorer — see the standings.
            </p>
          </CardContent>
        </Card>

        {isMine && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Your secret over/under</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-ice-400">
                Guess your roster&rsquo;s final point total. Only the final
                tiebreaker uses it — closest guess wins. Set it before the
                tournament.
              </p>
              <form action={setOverUnderAction} className="flex items-end gap-2">
                <input type="hidden" name="league_id" value={leagueId} />
                <input type="hidden" name="team_id" value={teamId} />
                <div className="space-y-1">
                  <Label htmlFor="over_under">Your guess</Label>
                  <Input
                    id="over_under"
                    name="over_under"
                    type="number"
                    defaultValue={team.over_under_guess ?? ""}
                    placeholder="e.g. 85"
                    className="max-w-[140px]"
                  />
                </div>
                <Button type="submit">Save</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

function Stat({ label, parts }: { label: string; parts: number[] }) {
  if (parts.length === 0) return null;
  // List each contribution (e.g. two upsets as "5, 5"), plus the running
  // total in parentheses when there's more than one so the sum stays handy.
  const list = parts.map((p) => fmtPoints(p)).join(", ");
  const sum = parts.reduce((a, b) => a + b, 0);
  return (
    <span>
      {label}:{" "}
      <span className="text-ice-200">
        {list}
        {parts.length > 1 && <span className="text-ice-500"> ({fmtPoints(sum)})</span>}
      </span>
    </span>
  );
}

/** Format a points value with an explicit sign (e.g. +3, -0.5, 0). */
function sgn(n: number): string {
  return n > 0 ? `+${fmtPoints(n)}` : fmtPoints(n);
}

/** Scoring legend, mirroring the per-country breakdown categories above. */
const SCORING_LEGEND: Array<[string, string]> = [
  ["Result", `Win ${sgn(WIN_POINTS)} · Draw ${sgn(DRAW_POINTS)} · Loss ${fmtPoints(LOSS_POINTS)} · Shootout win ${sgn(SHOOTOUT_WIN_POINTS)} / loss ${sgn(SHOOTOUT_LOSS_POINTS)}`],
  ["Goals for", `${sgn(GOAL_FOR_POINTS)} per goal scored`],
  ["Goals against", `${sgn(GOAL_AGAINST_POINTS)} per goal conceded`],
  ["Clean sheet", `${sgn(CLEAN_SHEET_POINTS)} when you concede none in a match`],
  ["Upset", `${sgn(UPSET_POINTS)} for a group-stage win over a higher-ranked team`],
  ["Advancement", `${sgn(ADVANCEMENT_POINTS.r16)} each time you reach a knockout round`],
  ["Champion", `${sgn(CHAMPION_POINTS)} for winning the tournament`],
  ["Runner-up", `${sgn(RUNNER_UP_POINTS)} for losing the final`],
  ["Third place", `${sgn(THIRD_PLACE_POINTS)} for winning the third-place playoff`],
];

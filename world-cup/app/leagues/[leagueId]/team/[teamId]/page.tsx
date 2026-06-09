import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { scoreCountry } from "@/lib/scoring";
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
  const user = await getUser();
  if (!user) redirect("/login");

  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");

  const { league, teams, ownerNames, isCommissioner, displayName } = access;
  const team = teams.find((t) => t.id === teamId);
  if (!team) redirect(`/leagues/${leagueId}`);

  const isMine = team.owner_id === user.id;
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
                    <Stat label="Results" v={s.match_points} />
                    <Stat label="GF" v={s.goals_for_points} />
                    <Stat label="GA" v={s.goals_against_points} />
                    <Stat label="CS" v={s.clean_sheet_points} />
                    <Stat label="Upset" v={s.upset_points} />
                    <Stat label="Advance" v={s.advancement_points} />
                    <Stat label="Champion" v={s.champion_points} />
                    <Stat label="Runner-up" v={s.runner_up_points} />
                    <Stat label="3rd place" v={s.third_place_points} />
                  </div>
                </div>
              ) : null,
            )}
          </div>
        )}

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

function Stat({ label, v }: { label: string; v: number }) {
  if (!v) return null;
  return (
    <span>
      {label}: <span className="text-ice-200">{fmtPoints(v)}</span>
    </span>
  );
}

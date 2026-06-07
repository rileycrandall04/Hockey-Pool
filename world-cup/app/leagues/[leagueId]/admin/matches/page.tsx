import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Country, Match, Stage } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGES: Stage[] = ["group", "r32", "r16", "qf", "sf", "third", "final"];

async function requireCommish(leagueId: string) {
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  if (!access.isCommissioner) redirect(`/leagues/${leagueId}`);
  return access;
}

/** Parse an optional integer form field (empty -> null). */
function intOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : Math.trunc(Number(s));
}

async function saveMatchAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  await requireCommish(leagueId);

  const matchId = String(formData.get("match_id") ?? "").trim();
  const homeId = intOrNull(formData.get("home_country_id"));
  const awayId = intOrNull(formData.get("away_country_id"));
  if (!homeId || !awayId || homeId === awayId) {
    redirect(`/leagues/${leagueId}/admin/matches?error=Pick+two+different+teams`);
  }

  const wentToShootout = formData.get("shootout") === "on";
  const kickoffRaw = String(formData.get("kickoff") ?? "").trim();
  const row = {
    stage: String(formData.get("stage") ?? "group"),
    matchday: intOrNull(formData.get("matchday")),
    home_country_id: homeId,
    away_country_id: awayId,
    kickoff_utc: kickoffRaw === "" ? null : new Date(kickoffRaw).toISOString(),
    status: String(formData.get("status") ?? "scheduled"),
    home_goals: intOrNull(formData.get("home_goals")),
    away_goals: intOrNull(formData.get("away_goals")),
    went_to_shootout: wentToShootout,
    home_pens: wentToShootout ? intOrNull(formData.get("home_pens")) : null,
    away_pens: wentToShootout ? intOrNull(formData.get("away_pens")) : null,
    locked: true, // manual edits win over the API sync
    updated_at: new Date().toISOString(),
  };

  const svc = createServiceClient();
  if (matchId) {
    await svc.from("matches").update(row).eq("id", matchId);
  } else {
    await svc.from("matches").insert(row);
  }

  revalidatePath(`/leagues/${leagueId}/admin/matches`);
  redirect(`/leagues/${leagueId}/admin/matches?saved=1`);
}

async function deleteMatchAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  await requireCommish(leagueId);
  const matchId = String(formData.get("match_id") ?? "");
  const svc = createServiceClient();
  await svc.from("matches").delete().eq("id", matchId);
  revalidatePath(`/leagues/${leagueId}/admin/matches`);
  redirect(`/leagues/${leagueId}/admin/matches`);
}

export default async function MatchesAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ edit?: string; error?: string; saved?: string }>;
}) {
  const { leagueId } = await params;
  const { edit, error, saved } = await searchParams;
  const access = await requireCommish(leagueId);
  const { league, displayName } = access;

  const svc = createServiceClient();
  const [{ data: countryRows }, { data: matchRows }] = await Promise.all([
    svc.from("countries").select("*").order("name"),
    svc.from("matches").select("*").order("stage").order("kickoff_utc", { nullsFirst: true }),
  ]);
  const countries = (countryRows ?? []) as Country[];
  const matches = (matchRows ?? []) as Match[];
  const countryById = new Map(countries.map((c) => [c.id, c]));
  const editing = edit ? matches.find((m) => m.id === edit) ?? null : null;

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-ice-50">Match results</h1>
          <Link href={`/leagues/${leagueId}/admin`} className="text-xs text-ice-400 hover:underline">
            ← Admin
          </Link>
        </div>

        {saved && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
            ✅ Saved. Standings recompute automatically.
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{editing ? "Edit match" : "Add a match result"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={saveMatchAction} className="space-y-3">
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="match_id" value={editing?.id ?? ""} />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="home_country_id">Home</Label>
                  <Select id="home_country_id" name="home_country_id" defaultValue={editing?.home_country_id ?? ""}>
                    <option value="">—</option>
                    {countries.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="away_country_id">Away</Label>
                  <Select id="away_country_id" name="away_country_id" defaultValue={editing?.away_country_id ?? ""}>
                    <option value="">—</option>
                    {countries.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="stage">Stage</Label>
                  <Select id="stage" name="stage" defaultValue={editing?.stage ?? "group"}>
                    {STAGES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="matchday">Matchday</Label>
                  <Input id="matchday" name="matchday" type="number" defaultValue={editing?.matchday ?? ""} placeholder="1-3" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="status">Status</Label>
                  <Select id="status" name="status" defaultValue={editing?.status ?? "final"}>
                    <option value="scheduled">scheduled</option>
                    <option value="live">live</option>
                    <option value="final">final</option>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="kickoff">Kickoff (so it shows on the schedule)</Label>
                <Input id="kickoff" name="kickoff" type="datetime-local" defaultValue={editing?.kickoff_utc ? editing.kickoff_utc.slice(0, 16) : ""} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="home_goals">Home goals (reg + ET)</Label>
                  <Input id="home_goals" name="home_goals" type="number" defaultValue={editing?.home_goals ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="away_goals">Away goals (reg + ET)</Label>
                  <Input id="away_goals" name="away_goals" type="number" defaultValue={editing?.away_goals ?? ""} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-ice-200">
                <input type="checkbox" name="shootout" defaultChecked={editing?.went_to_shootout ?? false} />
                Went to a penalty shootout (knockout only)
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="home_pens">Home PKs</Label>
                  <Input id="home_pens" name="home_pens" type="number" defaultValue={editing?.home_pens ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="away_pens">Away PKs</Label>
                  <Input id="away_pens" name="away_pens" type="number" defaultValue={editing?.away_pens ?? ""} />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit">{editing ? "Update" : "Add"} match</Button>
                {editing && (
                  <Link href={`/leagues/${leagueId}/admin/matches`}>
                    <Button type="button" variant="secondary">Cancel edit</Button>
                  </Link>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="overflow-hidden rounded-xl border border-puck-border">
          <table className="w-full text-sm">
            <thead className="bg-puck-card text-left text-xs uppercase tracking-wider text-ice-400">
              <tr>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2 text-center">Score</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {matches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-ice-400">
                    No matches yet. Add one above, or run the API sync from the Admin page.
                  </td>
                </tr>
              ) : (
                matches.map((m) => {
                  const h = countryById.get(m.home_country_id);
                  const a = countryById.get(m.away_country_id);
                  const score =
                    m.home_goals == null || m.away_goals == null
                      ? "—"
                      : `${m.home_goals}–${m.away_goals}${m.went_to_shootout ? ` (${m.home_pens}–${m.away_pens} pens)` : ""}`;
                  return (
                    <tr key={m.id} className="border-t border-puck-border bg-puck-bg">
                      <td className="px-3 py-2 text-ice-400">
                        {m.stage}
                        {m.locked && <span title="Locked from API sync"> 🔒</span>}
                      </td>
                      <td className="px-3 py-2 text-ice-100">
                        <span className="inline-flex items-center gap-1">
                          <Flag code={h?.code} /> {h?.code ?? "?"} v <Flag code={a?.code} /> {a?.code ?? "?"}
                          <span className="ml-1 text-xs text-ice-500">{m.status}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-ice-200">{score}</td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/leagues/${leagueId}/admin/goals/${m.id}`} className="text-ice-400 hover:underline">
                          goals
                        </Link>
                        <Link href={`/leagues/${leagueId}/admin/matches?edit=${m.id}`} className="ml-2 text-ice-400 hover:underline">
                          edit
                        </Link>
                        <form action={deleteMatchAction} className="ml-2 inline">
                          <input type="hidden" name="league_id" value={leagueId} />
                          <input type="hidden" name="match_id" value={m.id} />
                          <button type="submit" className="text-red-400 hover:underline">del</button>
                        </form>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

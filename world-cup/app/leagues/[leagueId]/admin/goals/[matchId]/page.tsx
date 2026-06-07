import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { isAppAdmin } from "@/lib/admin";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Country, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireAdmin(leagueId: string) {
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const svc = createServiceClient();
  const ok = await isAppAdmin(svc, user.id, user.email);
  if (!ok) redirect(`/leagues/${leagueId}`);
  return { access, svc, user };
}

/** Find an existing player (by name + country) or create one. Manual = no external_id. */
async function resolvePlayerId(svc: ReturnType<typeof createServiceClient>, name: string, countryId: number | null): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data: existing } = await svc
    .from("players")
    .select("id")
    .ilike("name", trimmed)
    .eq("country_id", countryId ?? 0)
    .maybeSingle();
  if (existing) return existing.id as number;
  const { data: created } = await svc
    .from("players")
    .insert({ name: trimmed, country_id: countryId })
    .select("id")
    .single();
  return (created?.id as number) ?? null;
}

async function addGoalAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const { svc } = await requireAdmin(leagueId);

  const countryId = Number(formData.get("country_id")) || null;
  const scorer = String(formData.get("scorer") ?? "");
  const minuteRaw = String(formData.get("minute") ?? "").trim();
  const type = String(formData.get("type") ?? "regular");

  const playerId = await resolvePlayerId(svc, scorer, countryId);
  await svc.from("match_goals").insert({
    match_id: matchId,
    country_id: countryId,
    scorer_player_id: playerId,
    minute: minuteRaw === "" ? null : Math.trunc(Number(minuteRaw)),
    type,
    is_shootout: false,
    manual: true,
  });

  revalidatePath(`/leagues/${leagueId}/admin/goals/${matchId}`);
  redirect(`/leagues/${leagueId}/admin/goals/${matchId}`);
}

async function deleteGoalAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const matchId = String(formData.get("match_id") ?? "");
  const goalId = String(formData.get("goal_id") ?? "");
  const { svc } = await requireAdmin(leagueId);
  await svc.from("match_goals").delete().eq("id", goalId);
  revalidatePath(`/leagues/${leagueId}/admin/goals/${matchId}`);
  redirect(`/leagues/${leagueId}/admin/goals/${matchId}`);
}

export default async function GoalsAdminPage({
  params,
}: {
  params: Promise<{ leagueId: string; matchId: string }>;
}) {
  const { leagueId, matchId } = await params;
  const { access, svc } = await requireAdmin(leagueId);
  const { league, displayName, isCommissioner } = access;

  const { data: match } = await svc.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (!match) redirect(`/leagues/${leagueId}/schedule`);
  const m = match as Match;

  const { data: countryRows } = await svc.from("countries").select("*");
  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Country]));
  const home = countryById.get(m.home_country_id);
  const away = countryById.get(m.away_country_id);

  const { data: goalRows } = await svc
    .from("match_goals")
    .select("id, country_id, minute, type, manual, players(name)")
    .eq("match_id", matchId)
    .order("minute", { nullsFirst: true });

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} />
      <main className="mx-auto max-w-xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-ice-50">Enter goals</h1>
          <Link href={`/leagues/${leagueId}/games/${matchId}`} className="text-xs text-ice-400 hover:underline">view game →</Link>
        </div>
        <p className="flex items-center gap-2 text-sm text-ice-200">
          <Flag code={home?.code} /> {home?.name ?? "?"}
          <span className="text-ice-500">v</span>
          <Flag code={away?.code} /> {away?.name ?? "?"}
        </p>

        <Card>
          <CardHeader><CardTitle>Add a goal</CardTitle></CardHeader>
          <CardContent>
            <form action={addGoalAction} className="space-y-3">
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="match_id" value={matchId} />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="country_id">Scored for</Label>
                  <Select id="country_id" name="country_id" defaultValue={m.home_country_id}>
                    {home && <option value={home.id}>{home.name}</option>}
                    {away && <option value={away.id}>{away.name}</option>}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="minute">Minute</Label>
                  <Input id="minute" name="minute" type="number" placeholder="e.g. 67" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="scorer">Scorer</Label>
                <Input id="scorer" name="scorer" placeholder="Player name" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="type">Type</Label>
                <Select id="type" name="type" defaultValue="regular">
                  <option value="regular">Regular</option>
                  <option value="penalty">Penalty</option>
                  <option value="own_goal">Own goal</option>
                </Select>
              </div>
              <Button type="submit">Add goal</Button>
            </form>
          </CardContent>
        </Card>

        <div className="overflow-hidden rounded-xl border border-puck-border">
          <table className="w-full text-sm">
            <tbody>
              {(goalRows ?? []).length === 0 ? (
                <tr><td className="px-3 py-4 text-center text-ice-400">No goals recorded.</td></tr>
              ) : (
                (goalRows ?? []).map((g) => {
                  const c = g.country_id != null ? countryById.get(g.country_id as number) : null;
                  const player = g.players as { name: string } | { name: string }[] | null;
                  const name = Array.isArray(player) ? player[0]?.name : player?.name;
                  return (
                    <tr key={g.id as string} className="border-t border-puck-border bg-puck-bg">
                      <td className="px-3 py-2 text-ice-100">
                        <span className="inline-flex items-center gap-1.5">
                          <Flag code={c?.code} />
                          {g.minute != null ? `${g.minute}' ` : ""}{name ?? "Unknown"}
                          {g.type === "penalty" ? " (P)" : g.type === "own_goal" ? " (OG)" : ""}
                          {g.manual ? <span className="text-[10px] text-ice-500"> ✍️</span> : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={deleteGoalAction} className="inline">
                          <input type="hidden" name="league_id" value={leagueId} />
                          <input type="hidden" name="match_id" value={matchId} />
                          <input type="hidden" name="goal_id" value={g.id as string} />
                          <button type="submit" className="text-red-400 hover:underline">delete</button>
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

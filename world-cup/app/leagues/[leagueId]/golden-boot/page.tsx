import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { GoldenBootIcon } from "@/components/golden-boot-icon";
import { GOLDEN_BOOT_POINTS } from "@/lib/scoring";
import { computeTopScorers } from "@/lib/top-scorers";

export const dynamic = "force-dynamic";

export default async function GoldenBootPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const user = await getUser();
  if (!user) redirect("/login");

  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const { league, teams, isCommissioner, displayName } = access;

  const svc = createServiceClient();
  const [scorers, { data: countryRows }, { data: pickRows }] = await Promise.all([
    computeTopScorers(svc, 25),
    svc.from("countries").select("id, name, code, flag_url"),
    svc.from("draft_picks").select("country_id, team_id").eq("league_id", leagueId),
  ]);

  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const ownerOfCountry = new Map<number, string>();
  for (const p of pickRows ?? []) {
    ownerOfCountry.set(p.country_id as number, teamName.get(p.team_id as string) ?? "—");
  }

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <h1 className="mb-1 inline-flex items-center gap-2 text-2xl font-bold text-ice-50"><GoldenBootIcon /> Golden Boot race</h1>
        <p className="mb-4 text-xs text-ice-400">
          The leader&rsquo;s owner gets <strong className="text-ice-200">+{GOLDEN_BOOT_POINTS}</strong> in
          the standings. Updates with each data sync.
        </p>

        {scorers.length === 0 ? (
          <p className="text-sm text-ice-300">
            No scorer data yet. It populates once matches with goals are synced from API-Football.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-puck-border">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-puck-card text-left text-xs uppercase tracking-wider text-ice-400">
                <tr>
                  <th className="px-2 py-2 sm:px-3">#</th>
                  <th className="px-2 py-2 sm:px-3">Player</th>
                  <th className="px-2 py-2 text-right sm:px-3">G</th>
                  <th className="px-2 py-2 sm:px-3">Owner</th>
                </tr>
              </thead>
              <tbody>
                {scorers.map((s, i) => {
                  const country = s.country_id != null ? countryById.get(s.country_id) : null;
                  const owner = s.country_id != null ? ownerOfCountry.get(s.country_id) : null;
                  const leader = i === 0;
                  return (
                    <tr
                      key={s.player_id ?? i}
                      className={"border-t border-puck-border " + (leader ? "bg-ice-500/10" : "bg-puck-bg")}
                    >
                      <td className="px-2 py-2 text-ice-400 sm:px-3">{i + 1}</td>
                      <td className="px-2 py-2 text-ice-50 sm:px-3">
                        <span className="inline-flex items-center gap-1.5">
                          {leader && <GoldenBootIcon />}
                          <Flag code={country?.code} url={country?.flag_url} />
                          {s.player_name}
                          <span className="text-xs text-ice-500">{country?.code ?? ""}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-ice-100 sm:px-3">{s.goals}</td>
                      <td className="px-2 py-2 text-ice-300 sm:px-3">
                        {owner ? <span className="text-ice-100">{owner}</span> : <span className="text-ice-500">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

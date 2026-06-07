import { redirect } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { buildGroupTables } from "@/lib/group-standings";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import type { Country, ScoringMatch } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const { league, isCommissioner, displayName } = access;

  const svc = createServiceClient();
  const [{ data: countryRows }, { data: matchRows }] = await Promise.all([
    svc.from("countries").select("*"),
    svc.from("matches").select("*"),
  ]);
  const tables = buildGroupTables(
    (countryRows ?? []) as Country[],
    (matchRows ?? []) as ScoringMatch[],
  );

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 text-2xl font-bold text-ice-50">Group tables</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          {tables.map((t) => (
            <div key={t.letter} className="overflow-hidden rounded-xl border border-puck-border">
              <div className="bg-puck-card px-3 py-2 text-sm font-semibold text-ice-50">
                Group {t.letter}
              </div>
              <table className="w-full text-xs sm:text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wider text-ice-400">
                  <tr>
                    <th className="px-2 py-1.5">Team</th>
                    <th className="px-1 py-1.5 text-center">P</th>
                    <th className="px-1 py-1.5 text-center">W</th>
                    <th className="px-1 py-1.5 text-center">D</th>
                    <th className="px-1 py-1.5 text-center">L</th>
                    <th className="px-1 py-1.5 text-center">GD</th>
                    <th className="px-1 py-1.5 text-center font-bold">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r, i) => (
                    <tr
                      key={r.country.id}
                      className={"border-t border-puck-border " + (i < 2 ? "bg-ice-500/10" : "bg-puck-bg")}
                    >
                      <td className="px-2 py-1.5">
                        <Link
                          href={`/leagues/${leagueId}/country/${r.country.id}`}
                          className="inline-flex items-center gap-1.5 text-ice-100 hover:underline"
                        >
                          <Flag code={r.country.code} url={r.country.flag_url} />
                          <span className="truncate">{r.country.name}</span>
                        </Link>
                      </td>
                      <td className="px-1 py-1.5 text-center text-ice-300">{r.played}</td>
                      <td className="px-1 py-1.5 text-center text-ice-300">{r.won}</td>
                      <td className="px-1 py-1.5 text-center text-ice-300">{r.drawn}</td>
                      <td className="px-1 py-1.5 text-center text-ice-300">{r.lost}</td>
                      <td className="px-1 py-1.5 text-center text-ice-300">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                      <td className="px-1 py-1.5 text-center font-bold text-ice-50">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ice-500">Top two of each group (highlighted) advance. Tap a team for its match history.</p>
      </main>
    </>
  );
}

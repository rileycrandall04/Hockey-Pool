import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { requireLeagueView } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import type { Country } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CountriesPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const access = await requireLeagueView(leagueId);

  const { league, teams, isCommissioner, displayName, readOnly } = access;
  const svc = createServiceClient();

  const [{ data: countryRows }, { data: pickRows }] = await Promise.all([
    svc.from("countries").select("*").order("group_letter").order("fifa_rank"),
    svc.from("draft_picks").select("country_id, team_id").eq("league_id", leagueId),
  ]);

  const countries = (countryRows ?? []) as Country[];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const ownerOfCountry = new Map<number, string>();
  for (const p of pickRows ?? []) {
    ownerOfCountry.set(p.country_id as number, teamName.get(p.team_id as string) ?? "—");
  }

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
        <h1 className="mb-1 text-2xl font-bold text-ice-50">Countries</h1>
        <p className="mb-4 text-xs text-ice-400">
          The 48-team field ({countries.length} loaded). FIFA ranks &amp; groups
          are seed values until the official data syncs in.
        </p>

        {countries.length === 0 ? (
          <p className="text-sm text-ice-300">
            No countries loaded yet. Run migration 0002 to seed the field.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-puck-border">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-puck-card text-left text-xs uppercase tracking-wider text-ice-400">
                <tr>
                  <th className="px-2 py-2 sm:px-3">Grp</th>
                  <th className="px-2 py-2 sm:px-3">Country</th>
                  <th className="px-2 py-2 text-right sm:px-3">FIFA</th>
                  <th className="px-2 py-2 sm:px-3">Owner</th>
                </tr>
              </thead>
              <tbody>
                {countries.map((c) => {
                  const owner = ownerOfCountry.get(c.id);
                  return (
                    <tr key={c.id} className="border-t border-puck-border bg-puck-bg">
                      <td className="px-2 py-2 text-ice-400 sm:px-3">{c.group_letter ?? "—"}</td>
                      <td className="px-2 py-2 font-medium text-ice-50 sm:px-3">
                        <Link
                          href={`/leagues/${leagueId}/country/${c.id}`}
                          className="inline-flex items-center gap-2 hover:underline"
                        >
                          <Flag code={c.code} url={c.flag_url} />
                          {c.name}{" "}
                          <span className="text-xs text-ice-500">{c.code}</span>
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right text-ice-300 sm:px-3">
                        {c.fifa_rank ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-ice-300 sm:px-3">
                        {owner ? (
                          <span className="text-ice-100">{owner}</span>
                        ) : (
                          <span className="text-ice-500">undrafted</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-ice-500">
          <Link href={`/leagues/${leagueId}`} className="hover:underline">
            ← Back to standings
          </Link>
        </p>
      </main>
    </>
  );
}

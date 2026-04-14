import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  currentSeason,
  fetchAllTeams,
  fetchTeamRoster,
  fetchTeamSeasonStats,
  fetchEliminatedTeams,
  fetchPlayerInjury,
} from "@/lib/nhl-api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Live NHL endpoint debug page.
 *
 * Hits each of the public NHL API endpoints we depend on and shows a
 * human-readable summary of what came back. Useful for verifying that:
 *   - The season string we compute is the right one for "right now"
 *   - The /club-stats/{abbrev}/{season}/2 endpoint actually returns
 *     skater rows for the current season
 *   - The injury and standings endpoints are reachable
 *
 * Auth: any signed-in user. No commissioner gate because this is
 * read-only and useful for any league member to confirm data is fresh.
 */
export default async function DebugNhlPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const season = currentSeason();

  // Run every fetch in parallel so the page loads in one network burst
  const [allTeams, torRoster, torSeason, eliminated, mcDavidInjury] =
    await Promise.all([
      fetchAllTeams().catch((e) => ({ error: e instanceof Error ? e.message : "fail" })),
      fetchTeamRoster("TOR").catch((e) => ({ error: e instanceof Error ? e.message : "fail" })),
      fetchTeamSeasonStats("TOR", season).catch(
        (e) => ({ error: e instanceof Error ? e.message : "fail" }),
      ),
      fetchEliminatedTeams().catch(
        () => new Set<string>(),
      ),
      // McDavid's NHL ID — a known stable test target
      fetchPlayerInjury(8478402).catch((e) => ({
        error: e instanceof Error ? e.message : "fail",
      })),
    ]);

  return (
    <>
      <NavBar displayName={user.email ?? "Player"} />
      <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <div>
          <Link href="/dashboard" className="text-sm text-ice-400 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-ice-50">NHL endpoint check</h1>
          <p className="text-sm text-ice-300">
            Live result of every NHL API call this app makes. If anything
            below shows zero rows or an error, that&rsquo;s why the
            corresponding feature is empty.
          </p>
        </div>

        <Section title="Season string we'll use">
          <div className="font-mono text-ice-100">{season}</div>
          <p className="mt-1 text-xs text-ice-400">
            This is the value passed to{" "}
            <span className="font-mono">/club-stats/{`{team}`}/{season}/2</span>.
            For Apr–Sep we&rsquo;re in the latter half of the previous
            season; for Oct–Dec we&rsquo;re in the new one.
          </p>
        </Section>

        <Section title="Standings (/standings/now)">
          {Array.isArray(allTeams) ? (
            <div>
              ✅ {allTeams.length} teams returned.{" "}
              <span className="text-ice-400">
                First few: {allTeams.slice(0, 5).map((t) => t.abbrev).join(", ")}…
              </span>
            </div>
          ) : (
            <div className="text-red-300">❌ {(allTeams as { error: string }).error}</div>
          )}
        </Section>

        <Section title="Toronto roster (/roster/TOR/current)">
          {Array.isArray(torRoster) ? (
            <div>
              ✅ {torRoster.length} players returned.{" "}
              <span className="text-ice-400">
                Sample:{" "}
                {torRoster
                  .slice(0, 3)
                  .map((p) => p.full_name)
                  .join(", ")}
              </span>
            </div>
          ) : (
            <div className="text-red-300">
              ❌ {(torRoster as { error: string }).error}
            </div>
          )}
        </Section>

        <Section title={`Toronto season stats (/club-stats/TOR/${season}/2)`}>
          {Array.isArray(torSeason) ? (
            torSeason.length === 0 ? (
              <div className="text-yellow-300">
                ⚠️ Endpoint returned 0 skaters. The season string{" "}
                <span className="font-mono">{season}</span> may be
                wrong, or the API path may have changed.
              </div>
            ) : (
              <div>
                ✅ {torSeason.length} skater rows returned.
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-ice-400">
                      <th className="px-2 py-1">Player ID</th>
                      <th className="px-2 py-1 text-right">G</th>
                      <th className="px-2 py-1 text-right">A</th>
                      <th className="px-2 py-1 text-right">P</th>
                      <th className="px-2 py-1 text-right">GP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {torSeason
                      .slice()
                      .sort((a, b) => b.points - a.points)
                      .slice(0, 5)
                      .map((s) => (
                        <tr
                          key={s.playerId}
                          className="border-t border-puck-border"
                        >
                          <td className="px-2 py-1 font-mono text-ice-300">
                            {s.playerId}
                          </td>
                          <td className="px-2 py-1 text-right text-ice-200">
                            {s.goals}
                          </td>
                          <td className="px-2 py-1 text-right text-ice-200">
                            {s.assists}
                          </td>
                          <td className="px-2 py-1 text-right font-semibold text-ice-50">
                            {s.points}
                          </td>
                          <td className="px-2 py-1 text-right text-ice-300">
                            {s.gamesPlayed}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-ice-400">
                  Top 5 Toronto skaters by points. If these point totals
                  match what you see on nhl.com today, the data is current.
                </p>
              </div>
            )
          ) : (
            <div className="text-red-300">
              ❌ {(torSeason as { error: string }).error}
            </div>
          )}
        </Section>

        <Section title="Eliminated teams (/standings/now → clinchIndicator='e')">
          {eliminated instanceof Set ? (
            eliminated.size === 0 ? (
              <div className="text-ice-300">
                None reported. (Common until very late in the regular
                season; during the playoffs themselves use the
                commissioner override.)
              </div>
            ) : (
              <div>
                ✅ {[...eliminated].join(", ")}
              </div>
            )
          ) : (
            <div className="text-red-300">unknown</div>
          )}
        </Section>

        <Section title="Player landing — Connor McDavid (/player/8478402/landing)">
          {"status" in (mcDavidInjury as object) &&
          !(mcDavidInjury as { error?: string }).error ? (
            <div>
              currentInjury:{" "}
              <span className="font-mono text-ice-100">
                {JSON.stringify(mcDavidInjury)}
              </span>
              <p className="mt-1 text-xs text-ice-400">
                If status is null, McDavid is healthy as far as the API
                knows. If you see an error here, the player landing
                endpoint isn&rsquo;t reachable.
              </p>
            </div>
          ) : (
            <div className="text-red-300">
              ❌ {(mcDavidInjury as { error: string }).error}
            </div>
          )}
        </Section>
      </main>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
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
export const maxDuration = 60;

/**
 * Live NHL endpoint debug page.
 *
 * Hits each of the public NHL API endpoints we depend on and shows a
 * human-readable summary of what came back. Includes a per-team
 * matrix that runs the season-stats fetcher against ALL 32 NHL teams
 * in parallel so we can spot patterns when only some teams fail.
 *
 * Locked to the configured app owner because each page load fires
 * ~32+ external NHL API requests — not something random pool members
 * should be able to spam.
 */
export default async function DebugNhlPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAppOwner(user.email)) redirect("/dashboard");

  const season = currentSeason();

  // First: get the full team list so we know which 32 abbrevs to test
  const allTeamsResult = await fetchAllTeams().catch((e) => ({
    error: e instanceof Error ? e.message : "fail",
  }));
  const allTeams = Array.isArray(allTeamsResult) ? allTeamsResult : [];

  // Run the secondary fetches in parallel
  const [eliminated, mcDavidInjury, torRoster, allTeamStats] =
    await Promise.all([
      fetchEliminatedTeams().catch(() => new Set<string>()),
      fetchPlayerInjury(8478402).catch((e) => ({
        error: e instanceof Error ? e.message : "fail",
      })),
      fetchTeamRoster("TOR").catch((e) => ({
        error: e instanceof Error ? e.message : "fail",
      })),
      // Run season-stats fetcher for every team in parallel.
      Promise.all(
        allTeams.map(async (t) => ({
          abbrev: t.abbrev,
          result: await fetchTeamSeasonStats(t.abbrev, season),
        })),
      ),
    ]);

  const okCount = allTeamStats.filter((t) => t.result.rows.length > 0).length;
  const seasonOk = allTeamStats.filter((t) => t.result.source === "season").length;
  const nowOk = allTeamStats.filter((t) => t.result.source === "now").length;
  const noneCount = allTeamStats.filter((t) => t.result.source === "none").length;

  return (
    <>
      <NavBar displayName={user.email ?? "Player"} />
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <Link href="/dashboard" className="text-sm text-ice-400 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-ice-50">NHL endpoint check</h1>
          <p className="text-sm text-ice-300">
            Live result of every NHL API call this app makes. Each row
            below is a real request fired the moment you loaded this
            page.
          </p>
        </div>

        <Section title="Season string we'll use">
          <div className="font-mono text-ice-100">{season}</div>
          <p className="mt-1 text-xs text-ice-400">
            Passed to{" "}
            <span className="font-mono">/club-stats/{`{team}`}/{season}/2</span>.
          </p>
        </Section>

        <Section title="Standings (/standings/now)">
          {Array.isArray(allTeamsResult) ? (
            <div>
              ✅ {allTeamsResult.length} teams returned.{" "}
              <span className="text-ice-400">
                Sample: {allTeamsResult.slice(0, 5).map((t) => t.abbrev).join(", ")}…
              </span>
            </div>
          ) : (
            <div className="text-red-300">
              ❌ {(allTeamsResult as { error: string }).error}
            </div>
          )}
        </Section>

        <Section title="Per-team season stats">
          <div className="mb-3 text-sm text-ice-300">
            <span className="font-semibold text-green-400">{okCount}</span> /{" "}
            {allTeamStats.length} teams returned data.{" "}
            <span className="text-ice-400">
              ({seasonOk} via /club-stats/.../{season}/2,{" "}
              {nowOk} via /club-stats/.../now,{" "}
              {noneCount} failed)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-ice-400">
                <tr className="border-b border-puck-border">
                  <th className="px-2 py-2">Team</th>
                  <th className="px-2 py-2 text-right">Skaters</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Error (if any)</th>
                </tr>
              </thead>
              <tbody>
                {allTeamStats.map(({ abbrev, result }) => {
                  const tone =
                    result.source === "none"
                      ? "text-red-300"
                      : result.source === "now"
                        ? "text-yellow-300"
                        : "text-green-300";
                  return (
                    <tr
                      key={abbrev}
                      className="border-b border-puck-border last:border-0"
                    >
                      <td className="px-2 py-1.5 font-mono text-ice-100">
                        {abbrev}
                      </td>
                      <td className="px-2 py-1.5 text-right text-ice-200">
                        {result.rows.length}
                      </td>
                      <td className={`px-2 py-1.5 ${tone}`}>{result.source}</td>
                      <td
                        className="px-2 py-1.5 text-ice-400"
                        title={result.error ?? ""}
                      >
                        {result.error
                          ? result.error.slice(0, 90) +
                            (result.error.length > 90 ? "…" : "")
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ice-400">
            Source legend: <span className="text-green-300">season</span> = the
            documented{" "}
            <span className="font-mono">/club-stats/{`{abbrev}`}/{season}/2</span>{" "}
            endpoint returned data.{" "}
            <span className="text-yellow-300">now</span> = the season-specific
            URL came back empty so we fell back to{" "}
            <span className="font-mono">/club-stats/{`{abbrev}`}/now</span>.{" "}
            <span className="text-red-300">none</span> = both endpoints failed
            or returned 0 skaters; hover the error column for details.
          </p>
        </Section>

        <Section title="Toronto roster (/roster/TOR/current)">
          {Array.isArray(torRoster) ? (
            <div>
              ✅ {torRoster.length} players returned.{" "}
              <span className="text-ice-400">
                Sample:{" "}
                {torRoster.slice(0, 3).map((p) => p.full_name).join(", ")}
              </span>
            </div>
          ) : (
            <div className="text-red-300">
              ❌ {(torRoster as { error: string }).error}
            </div>
          )}
        </Section>

        <Section title="Eliminated teams (clinchIndicator='e')">
          {eliminated instanceof Set ? (
            eliminated.size === 0 ? (
              <div className="text-ice-300">
                None reported by /standings/now.
              </div>
            ) : (
              <div>✅ {[...eliminated].join(", ")}</div>
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

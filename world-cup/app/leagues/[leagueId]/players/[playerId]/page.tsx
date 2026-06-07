import { redirect } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { isScoringGoal } from "@/lib/player-stats";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import type { Country, Match } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GoalWithMatch {
  match_id: string;
  minute: number | null;
  type: string;
  is_shootout: boolean;
  matches: Match | null;
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ leagueId: string; playerId: string }>;
}) {
  const { leagueId, playerId } = await params;
  const pid = Number(playerId);
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const { league, isCommissioner, displayName } = access;

  const svc = createServiceClient();
  const { data: player } = await svc.from("players").select("*").eq("id", pid).maybeSingle();
  if (!player) redirect(`/leagues/${leagueId}/players`);

  const [{ data: goalRows }, { data: countryRows }, { data: ts }] = await Promise.all([
    svc.from("match_goals").select("match_id, minute, type, is_shootout, matches(*)").eq("scorer_player_id", pid),
    svc.from("countries").select("id, name, code"),
    svc.from("top_scorers").select("goals, assists, minutes, rank").eq("player_id", pid).maybeSingle(),
  ]);

  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Pick<Country, "id" | "name" | "code">]));
  const myCountry = player.country_id != null ? countryById.get(player.country_id) : null;
  const goals = (goalRows ?? []) as unknown as GoalWithMatch[];
  const scoringGoals = goals.filter((g) => isScoringGoal(g));
  // Group goals by match for a tidy log.
  const byMatch = new Map<string, GoalWithMatch[]>();
  for (const g of scoringGoals) {
    const arr = byMatch.get(g.match_id) ?? [];
    arr.push(g);
    byMatch.set(g.match_id, arr);
  }

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} />
      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <Flag code={myCountry?.code} className="!w-8 !h-6" />
          <div>
            <h1 className="text-2xl font-bold text-ice-50">{player.name}</h1>
            {myCountry && (
              <Link href={`/leagues/${leagueId}/country/${myCountry.id}`} className="text-xs text-ice-400 hover:underline">
                {myCountry.name}
              </Link>
            )}
          </div>
        </div>

        <div className="mb-5 flex gap-4 rounded-md border border-puck-border bg-puck-card px-4 py-3 text-sm">
          <Metric label="Goals" value={scoringGoals.length} />
          {ts?.assists != null && <Metric label="Assists" value={ts.assists as number} />}
          {ts?.minutes != null && <Metric label="Minutes" value={ts.minutes as number} />}
          {ts?.rank != null && <Metric label="Boot rank" value={`#${ts.rank}`} />}
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ice-400">Goal log</h2>
        {scoringGoals.length === 0 ? (
          <p className="text-sm text-ice-400">No goals recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {[...byMatch.entries()].map(([matchId, gs]) => {
              const m = gs[0].matches;
              const home = m ? countryById.get(m.home_country_id) : null;
              const away = m ? countryById.get(m.away_country_id) : null;
              return (
                <Link
                  key={matchId}
                  href={`/leagues/${leagueId}/games/${matchId}`}
                  className="flex items-center justify-between rounded-md border border-puck-border bg-puck-bg p-3 hover:border-ice-400"
                >
                  <span className="flex items-center gap-1.5 text-sm text-ice-100">
                    <Flag code={home?.code} /> {home?.code ?? "?"}
                    <span className="text-ice-500">v</span>
                    <Flag code={away?.code} /> {away?.code ?? "?"}
                  </span>
                  <span className="text-xs text-ice-300">
                    {gs.length > 1 ? `${gs.length} goals · ` : ""}
                    {gs.map((g) => `${g.minute ?? "?"}'${g.type === "penalty" ? " (P)" : ""}`).join(", ")}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-lg font-bold text-ice-50">{value}</div>
      <div className="text-xs text-ice-400">{label}</div>
    </div>
  );
}

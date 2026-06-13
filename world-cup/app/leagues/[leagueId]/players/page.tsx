import { createServiceClient } from "@/lib/supabase/server";
import { requireLeagueView } from "@/lib/league-access";
import { aggregatePlayerGoals } from "@/lib/player-stats";
import { NavBar } from "@/components/nav-bar";
import { PlayersSearch, type PlayerItem } from "@/components/players-search";
import type { Country, MatchGoal, Player } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PlayersPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const access = await requireLeagueView(leagueId);
  const { league, isCommissioner, displayName, readOnly } = access;

  const svc = createServiceClient();
  const [{ data: playerRows }, { data: goalRows }, { data: countryRows }] = await Promise.all([
    svc.from("players").select("*"),
    svc.from("match_goals").select("scorer_player_id, type, is_shootout"),
    svc.from("countries").select("id, name, code, flag_url"),
  ]);

  const countryById = new Map((countryRows ?? []).map((c) => [c.id as number, c as Pick<Country, "id" | "name" | "code" | "flag_url">]));
  const aggregated = aggregatePlayerGoals(
    (playerRows ?? []) as Player[],
    (goalRows ?? []) as MatchGoal[],
  );
  const items: PlayerItem[] = aggregated.map((p) => {
    const c = p.country_id != null ? countryById.get(p.country_id) : null;
    return {
      id: p.id,
      name: p.name,
      goals: p.goals,
      country_code: c?.code ?? null,
      country_name: c?.name ?? null,
      country_flag_url: c?.flag_url ?? null,
    };
  });

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} readOnly={readOnly} />
      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
        <h1 className="mb-1 text-2xl font-bold text-ice-50">Players</h1>
        <p className="mb-4 text-xs text-ice-400">
          Players appear here once they&rsquo;ve been involved in a synced or
          hand-entered goal.
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-ice-300">No players yet — they populate as goals are recorded.</p>
        ) : (
          <PlayersSearch leagueId={leagueId} items={items} />
        )}
      </main>
    </>
  );
}

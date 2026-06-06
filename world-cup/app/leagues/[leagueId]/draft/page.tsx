import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { NavBar } from "@/components/nav-bar";
import { DraftRoom } from "@/components/draft-room";
import type { DraftCountry, DraftPick, DraftTeam } from "@/components/draft-room";

export const dynamic = "force-dynamic";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const user = await getUser();
  if (!user) redirect("/login");

  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");

  const { league, teams, ownerNames, isCommissioner, displayName, myTeam } = access;
  const svc = createServiceClient();

  const [{ data: countryRows }, { data: pickRows }] = await Promise.all([
    svc.from("countries").select("id, name, code, group_letter, confederation, fifa_rank"),
    svc.from("draft_picks").select("country_id, team_id, round, pick_number").eq("league_id", leagueId),
  ]);

  const draftTeams: DraftTeam[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    owner_name: ownerNames.get(t.owner_id) ?? "Player",
    draft_position: t.draft_position,
  }));

  return (
    <>
      <NavBar
        displayName={displayName}
        leagueId={leagueId}
        draftStatus={league.draft_status}
        isCommissioner={isCommissioner}
      />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 text-2xl font-bold text-ice-50">
          {league.name} — Draft
        </h1>
        <DraftRoom
          leagueId={leagueId}
          joinCode={league.join_code}
          isCommissioner={isCommissioner}
          myTeamId={myTeam?.id ?? null}
          draftStatus={league.draft_status}
          rosterSize={league.roster_size}
          teams={draftTeams}
          countries={(countryRows ?? []) as DraftCountry[]}
          picks={(pickRows ?? []) as DraftPick[]}
        />
      </main>
    </>
  );
}

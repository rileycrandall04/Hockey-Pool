import { createClient, createServiceClient } from "./supabase/server";
import type { League, Team } from "./types";

export interface LeagueAccess {
  user: { id: string; email: string | null };
  displayName: string;
  league: League;
  teams: Team[];
  /** owner_id -> display name */
  ownerNames: Map<string, string>;
  myTeam: Team | null;
  isCommissioner: boolean;
}

/**
 * Load a league plus its teams and resolve the caller's membership.
 * Returns null if the league doesn't exist or the user is neither a
 * member nor the commissioner. Uses the service client for league/team
 * reads so member visibility never trips on embedded-join RLS quirks.
 */
export async function loadLeagueAccess(
  leagueId: string,
  userId: string,
  userEmail: string | null,
): Promise<LeagueAccess | null> {
  const svc = createServiceClient();

  const { data: league } = await svc
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();
  if (!league) return null;

  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .order("draft_position", { ascending: true, nullsFirst: false });
  const teamList = (teams ?? []) as Team[];

  const isCommissioner = (league as League).commissioner_id === userId;
  const myTeam = teamList.find((t) => t.owner_id === userId) ?? null;
  if (!isCommissioner && !myTeam) return null; // not a member

  const ownerIds = [...new Set(teamList.map((t) => t.owner_id))];
  const ownerNames = new Map<string, string>();
  let displayName = userEmail ?? "Player";
  if (ownerIds.length > 0) {
    const { data: profiles } = await svc
      .from("profiles")
      .select("id, display_name")
      .in("id", ownerIds);
    for (const p of profiles ?? []) {
      ownerNames.set(p.id as string, (p.display_name as string) ?? "Player");
      if (p.id === userId) displayName = (p.display_name as string) ?? displayName;
    }
  }

  return {
    user: { id: userId, email: userEmail },
    displayName,
    league: league as League,
    teams: teamList,
    ownerNames,
    myTeam,
    isCommissioner,
  };
}

/** Convenience: resolve the signed-in user or return null. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

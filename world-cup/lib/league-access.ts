import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "./supabase/server";
import { PUBLIC_VIEW_COOKIE } from "./public-view";
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
  /**
   * True when the caller is a logged-out (or non-member) visitor holding a
   * valid share link. They can see everything but must not be offered any
   * write controls — drafting, the over/under guess, admin tools, etc.
   */
  readOnly: boolean;
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
    readOnly: false,
  };
}

/**
 * Resolve read-only access for a logged-out visitor who arrived via a share
 * link. Trusts the share cookie only after re-checking its token against the
 * league row, so the cookie's value must equal this league's current
 * `public_view_token`. Returns null if there's no valid share for this league.
 */
async function loadPublicLeagueView(
  leagueId: string,
): Promise<LeagueAccess | null> {
  const token = (await cookies()).get(PUBLIC_VIEW_COOKIE)?.value;
  if (!token) return null;

  const svc = createServiceClient();
  const { data: league } = await svc
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .eq("public_view_token", token)
    .single();
  if (!league) return null;

  const { data: teams } = await svc
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .order("draft_position", { ascending: true, nullsFirst: false });
  const teamList = (teams ?? []) as Team[];

  const ownerIds = [...new Set(teamList.map((t) => t.owner_id))];
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profiles } = await svc
      .from("profiles")
      .select("id, display_name")
      .in("id", ownerIds);
    for (const p of profiles ?? []) {
      ownerNames.set(p.id as string, (p.display_name as string) ?? "Player");
    }
  }

  return {
    user: { id: "", email: null },
    displayName: "Guest · read-only",
    league: league as League,
    teams: teamList,
    ownerNames,
    myTeam: null,
    isCommissioner: false,
    readOnly: true,
  };
}

/**
 * Gate for any league page that should be visible both to members and to
 * read-only share-link visitors. Resolves full access for a signed-in member
 * or commissioner; otherwise falls back to read-only access if the caller
 * holds a valid share link. If neither applies it redirects (to /dashboard for
 * a signed-in non-member, /login for a logged-out visitor) and never returns.
 */
export async function requireLeagueView(
  leagueId: string,
): Promise<LeagueAccess> {
  const user = await getUser();
  if (user) {
    const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
    if (access) return access;
  }
  const guest = await loadPublicLeagueView(leagueId);
  if (guest) return guest;
  redirect(user ? "/dashboard" : "/login");
}

/** Convenience: resolve the signed-in user or return null. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

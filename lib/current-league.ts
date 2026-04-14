import { cookies } from "next/headers";
import { createClient } from "./supabase/server";
import type { DraftStatus } from "./types";

export interface CurrentLeagueContext {
  leagueId?: string;
  draftStatus?: DraftStatus;
  isCommissioner?: boolean;
}

/**
 * Read the "current league" cookie set by middleware and resolve
 * draft_status + commissioner_id so global pages can hand league
 * context to <NavBar> without duplicating the lookup.
 *
 * Usage from any server component whose page lives outside the
 * /leagues/[id]/... subtree:
 *
 *   const ctx = await getCurrentLeagueContext(user.id);
 *   <NavBar
 *     displayName={...}
 *     leagueId={ctx.leagueId}
 *     draftStatus={ctx.draftStatus}
 *     isCommissioner={ctx.isCommissioner}
 *   />
 *
 * Returns an empty object when:
 *   - The cookie is not set (user has never visited a league this
 *     session, or just came back from /dashboard via Switch leagues)
 *   - The cookie points at a league the user can no longer read
 *     (they left, the league was deleted, RLS blocks them, etc.)
 *
 * An empty result makes NavBar render its plain non-league menu, which
 * is the correct fallback behavior.
 */
export async function getCurrentLeagueContext(
  userId: string | undefined,
): Promise<CurrentLeagueContext> {
  if (!userId) return {};

  const cookieStore = await cookies();
  const leagueId = cookieStore.get("current_league_id")?.value;
  if (!leagueId) return {};

  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, draft_status, commissioner_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) return {};

  return {
    leagueId: league.id as string,
    draftStatus: league.draft_status as DraftStatus,
    isCommissioner: league.commissioner_id === userId,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { League } from "@/lib/types";

/**
 * Fetch a league by ID, working around a Supabase RLS edge case where
 * non-commissioner members can fail the `leagues` SELECT policy when
 * their JWT session state doesn't properly pass `auth.uid()` through
 * the `is_league_member()` check.
 *
 * Strategy:
 *   1. Try the RLS-bound client first (normal path).
 *   2. If RLS blocks the read, verify the user actually owns a team
 *      in the league via the service client, then read the league
 *      with the service client.
 *
 * Returns the league or null if the user genuinely has no access.
 */
export async function getLeagueForMember(
  supabase: SupabaseClient,
  leagueId: string,
  userId: string,
): Promise<League | null> {
  // Fast path: RLS lets the user read the league directly.
  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single<League>();

  if (league) return league;

  // RLS blocked. Fall back: verify membership, then read via service
  // client. This keeps the security boundary — we only serve the
  // league if the user has a team in it.
  const svc = createServiceClient();
  const { data: memberCheck } = await svc
    .from("teams")
    .select("id")
    .eq("league_id", leagueId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (!memberCheck) return null;

  const { data } = await svc
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single<League>();

  return data as League | null;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAppOwner } from "./auth";

/**
 * Is this user allowed to use global data tools (manual goal entry, syncs)?
 * True for the APP_OWNER_EMAIL, or any user listed in `app_admins`.
 */
export async function isAppAdmin(
  svc: SupabaseClient,
  userId: string,
  email: string | null | undefined,
): Promise<boolean> {
  if (isAppOwner(email)) return true;
  const { data } = await svc
    .from("app_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

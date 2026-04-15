import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import type { DailyRecap } from "@/lib/types";
import { DailyTickerClient } from "./daily-ticker-client";

/**
 * Server-side data loader for the daily scores ticker.
 *
 * Reads the most recent daily_recaps date that has any rows and hands
 * them to the client component. If the table is empty (pre-playoffs or
 * a freshly seeded install) we return null so the ticker is simply
 * absent rather than a broken shell.
 *
 * Uses the service client so anonymous visitors on the landing page
 * can see it without going through Supabase auth — daily_recaps is
 * public via RLS anyway. Also reads the current user's session
 * (using the regular client) to decide whether to surface the
 * per-game manual stats editor link on the ticker. The editor is
 * app-owner-only so non-owners never see the link.
 */
export async function DailyTicker() {
  const svc = createServiceClient();

  const { data: latest } = await svc
    .from("daily_recaps")
    .select("game_date")
    .order("game_date", { ascending: false })
    .limit(1);

  const date = latest?.[0]?.game_date as string | undefined;
  if (!date) return null;

  const { data: recaps } = await svc
    .from("daily_recaps")
    .select("*")
    .eq("game_date", date)
    .order("game_id", { ascending: true });

  const rows = (recaps ?? []) as DailyRecap[];
  if (rows.length === 0) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = isAppOwner(user?.email);

  return <DailyTickerClient date={date} games={rows} isOwner={isOwner} />;
}

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAppOwner } from "@/lib/auth";
import { syncMatches } from "@/lib/sync-matches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manually trigger a World Cup data sync. Same code path as the nightly
 * cron. Gated to the app owner (APP_OWNER_EMAIL) so random members can't
 * burn the API quota. Returns the sync summary.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAppOwner(user.email)) {
    return NextResponse.json(
      { error: "Only the app owner can run the data sync." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}) as Record<string, string>);
  const window = body.from || body.to ? { from: body.from, to: body.to } : undefined;

  try {
    const svc = createServiceClient();
    const summary = await syncMatches(svc, window);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

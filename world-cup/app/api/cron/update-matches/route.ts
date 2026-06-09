import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncMatches, hasActiveMatchWindow } from "@/lib/sync-matches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * World Cup ingestion endpoint. Pulls fixtures + the top-scorers leaderboard
 * from API-Football and upserts them. Locked (manually corrected) matches are
 * left untouched.
 *
 * Two intended cadences:
 *   - Nightly (Vercel cron): default "full" mode — also refreshes the team
 *     list, group letters, and FIFA ranks.
 *   - Live polling (external pinger, e.g. cron-job.org, every ~5 min): pass
 *     `?mode=light`. Add `&smart=1` so the poll only spends API calls when a
 *     game is actually live or about to start, and goes idle (one cheap DB
 *     read, zero API calls) the rest of the day. Recommended for the pinger.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel cron sends this) or an
 * `x-cron-secret` header. A `from`/`to` window can be passed as query params
 * or JSON body; the default (whole season) is a single fixtures request.
 */
async function run(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}) as Record<string, string>);
  const from = url.searchParams.get("from") ?? body.from;
  const to = url.searchParams.get("to") ?? body.to;
  const window = from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined;
  const mode = (url.searchParams.get("mode") ?? body.mode) === "light" ? "light" : "full";
  const smart = (url.searchParams.get("smart") ?? body.smart) === "1";

  const svc = createServiceClient();

  // Schedule-gated polling: when nothing is live or near kickoff, skip the
  // API entirely (one cheap DB read). The nightly full run is never gated.
  if (smart && mode === "light" && !(await hasActiveMatchWindow(svc))) {
    return NextResponse.json({ ok: true, mode, smart, skipped: "no active matches" });
  }

  const summary = await syncMatches(svc, { window, mode });
  return NextResponse.json({ ok: true, mode, smart, ...summary });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return auth === `Bearer ${secret}` || header === secret;
}

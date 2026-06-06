import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncMatches } from "@/lib/sync-matches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly World Cup ingestion. Pulls all fixtures + the top-scorers
 * leaderboard from API-Football and upserts them. Locked (manually
 * corrected) matches are left untouched.
 *
 * Vercel Cron sends a GET with an `Authorization: Bearer $CRON_SECRET`
 * header; we accept GET and POST. A manual `from`/`to` window can be
 * passed as query params or JSON body, but the default (whole season) is
 * cheap — it's a single fixtures request.
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

  const svc = createServiceClient();
  const summary = await syncMatches(svc, window);
  return NextResponse.json({ ok: true, ...summary });
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

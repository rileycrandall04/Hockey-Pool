import { NextResponse } from "next/server";
import { seedPlayers } from "@/lib/seed-players";

export const dynamic = "force-dynamic";
// NHL rosters for 32 teams + Supabase upserts can comfortably take 30+
// seconds. Vercel Hobby lets us bump serverless functions up to 60s.
export const maxDuration = 60;

/**
 * Seed / refresh the playoff player pool.
 *
 * Body (optional): { abbrevs: ["TOR","EDM",...] } — the list of qualifying
 * playoff teams to pull rosters for. If omitted we pull ALL current teams
 * so this can also be run pre-playoffs to pre-populate the draftable pool.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedAbbrevs: string[] | undefined = body.abbrevs;

  const result = await seedPlayers(requestedAbbrevs);
  return NextResponse.json({ ok: true, ...result });
}

// Vercel Cron always sends GET, so mirror the handler.
export async function GET(request: Request) {
  return POST(request);
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const header = request.headers.get("x-cron-secret") ?? "";
  return auth === `Bearer ${secret}` || header === secret;
}

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Draft stall-watch cron.
 *
 * Runs frequently (see vercel.json crons) and fires a web-push
 * notification to everyone who opted in via `draft_watches` when a
 * draft has had the same team on the clock for longer than that
 * watcher's configured threshold (default 15 minutes).
 *
 * The notification is deduped per pick: once a league sends a stall
 * alert for team X, `leagues.draft_stale_notified_for` is set to
 * team X and further cron ticks skip the league until the clock
 * advances (which clears the column in /api/draft/pick and the
 * admin rollback flow).
 *
 * Auth: same CRON_SECRET pattern as /api/cron/update-stats.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const summary = {
    ok: true,
    leagues_checked: 0,
    stalled: 0,
    notifications_sent: 0,
    errors: [] as string[],
  };

  // Every league currently drafting that has an on-clock team.
  const { data: leagues, error: leaguesError } = await svc
    .from("leagues")
    .select(
      "id, name, draft_current_team, draft_on_clock_since, draft_stale_notified_for, draft_started_at",
    )
    .eq("draft_status", "in_progress")
    .not("draft_current_team", "is", null);

  if (leaguesError) {
    return NextResponse.json(
      { error: leaguesError.message },
      { status: 500 },
    );
  }

  summary.leagues_checked = leagues?.length ?? 0;
  if (!leagues || leagues.length === 0) {
    return NextResponse.json(summary);
  }

  const now = Date.now();

  for (const league of leagues) {
    const currentTeamId = league.draft_current_team as string;

    // Already sent an alert for this exact pick — don't spam.
    if (league.draft_stale_notified_for === currentTeamId) continue;

    // Resolve "on clock since" with a fallback for drafts that
    // started before the column existed: use the most recent pick's
    // picked_at, or draft_started_at if there are no picks yet.
    let onClockSinceMs: number | null = null;
    const fromColumn = league.draft_on_clock_since as string | null;
    if (fromColumn) {
      onClockSinceMs = Date.parse(fromColumn);
    } else {
      const { data: lastPick } = await svc
        .from("draft_picks")
        .select("picked_at")
        .eq("league_id", league.id)
        .order("pick_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastPick?.picked_at) {
        onClockSinceMs = Date.parse(lastPick.picked_at as string);
      } else if (league.draft_started_at) {
        onClockSinceMs = Date.parse(league.draft_started_at as string);
      }
    }
    if (onClockSinceMs == null || Number.isNaN(onClockSinceMs)) continue;

    const elapsedMinutes = (now - onClockSinceMs) / 60_000;

    // Watchers for this league, each with their own threshold.
    const { data: watchers } = await svc
      .from("draft_watches")
      .select("user_id, stale_minutes")
      .eq("league_id", league.id);
    if (!watchers || watchers.length === 0) continue;

    // Anyone's threshold passed yet?
    const triggered = watchers.filter(
      (w) => elapsedMinutes >= (w.stale_minutes ?? 15),
    );
    if (triggered.length === 0) continue;

    summary.stalled += 1;

    // Look up the team + owner name for the push payload. Single
    // query per stalled league — cheap.
    const { data: teamRow } = await svc
      .from("teams")
      .select("name, owner_id, profiles(display_name)")
      .eq("id", currentTeamId)
      .maybeSingle();
    const teamName = (teamRow?.name as string | undefined) ?? "A team";
    const ownerRow = Array.isArray(teamRow?.profiles)
      ? teamRow?.profiles[0]
      : teamRow?.profiles;
    const ownerName = (ownerRow as { display_name?: string } | null)
      ?.display_name;

    const elapsedRounded = Math.round(elapsedMinutes);
    const body = ownerName
      ? `${teamName} (${ownerName}) has been on the clock for ${elapsedRounded} min`
      : `${teamName} has been on the clock for ${elapsedRounded} min`;

    for (const w of triggered) {
      try {
        const res = await sendPushToUser(w.user_id as string, {
          title: `⏰ Draft stalled in ${league.name}`,
          body,
          url: `/leagues/${league.id}/draft`,
          // Stable tag so a watcher who's already seen one alert
          // about this pick doesn't get the badge bumped again on
          // a retry.
          tag: `draft-stall-${league.id}-${currentTeamId}`,
        });
        summary.notifications_sent += res.sent;
      } catch (err) {
        summary.errors.push(
          `push to ${w.user_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Mark this pick as notified so subsequent cron ticks skip.
    const { error: markError } = await svc
      .from("leagues")
      .update({ draft_stale_notified_for: currentTeamId })
      .eq("id", league.id);
    if (markError) {
      summary.errors.push(
        `mark notified (${league.id}): ${markError.message}`,
      );
    }
  }

  return NextResponse.json(summary);
}

// Vercel Cron sends GETs by default, so mirror the POST handler for
// consistency with the existing /api/cron/update-stats route.
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

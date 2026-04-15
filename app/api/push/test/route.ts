import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Send a test push notification to the calling user's own devices.
 *
 * Used to diagnose "is the push pipeline actually working on this
 * device" without having to run a real draft. The happy path is:
 *
 *   1. User taps "Test push" in the draft room
 *   2. This route calls sendPushToUser(user.id, ...)
 *   3. Returns { sent, dead, errors } counters so the client can
 *      flash a result
 *   4. Every subscribed device of that user gets a push within a
 *      few seconds (or not, which is the diagnostic signal)
 *
 * Notes:
 *   - `sent` = web-push HTTP POST to the push service succeeded.
 *     This doesn't guarantee the OS will actually show the
 *     notification — iOS in particular can accept the push and
 *     silently drop it if the app is backgrounded and hasn't been
 *     added to the home screen.
 *   - `dead` = subscription was 404/410 and has been removed. If
 *     you see this, the subscription is stale and needs a fresh
 *     re-subscribe from the draft room.
 *   - `errors` = any other failure (network, VAPID misconfig, etc.)
 *     Check Vercel function logs for details.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await sendPushToUser(user.id, {
      title: "🏒 Test push",
      body: "If you see this, your device is set up correctly.",
      url: request.headers.get("referer") ?? "/dashboard",
      tag: "push-test",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

import webpush from "web-push";
import { createServiceClient } from "./supabase/server";

/**
 * Lazily configure VAPID details on first call. Deferred so that
 * importing this module in a file that never actually sends a push
 * (e.g., type checking) doesn't crash when the env vars are absent.
 */
let vapidConfigured = false;
function configureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@example.com";
  if (!publicKey || !privateKey) {
    throw new Error(
      "Push notifications are not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in env.",
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap on the notification should take the user. */
  url?: string;
  /** Stable tag so repeated pushes collapse into one badge. */
  tag?: string;
}

export interface SendPushResult {
  sent: number;
  dead: number;
  errors: number;
}

/**
 * Send a web-push notification to every device the given user has
 * subscribed. Returns a { sent, dead, errors } counter so callers can
 * log outcomes without caring about the details.
 *
 * Any subscription that responds with 404 Not Found or 410 Gone is
 * considered expired and deleted from push_subscriptions — the user
 * will need to re-subscribe next time they open the draft room.
 *
 * Safe to call with a userId that has zero subscriptions; just
 * returns zeros.
 *
 * If VAPID env vars aren't configured, returns all-zero counters
 * and silently no-ops rather than throwing, so callers in hot paths
 * (e.g., /api/draft/pick) can always await it without guarding.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendPushResult> {
  const result: SendPushResult = { sent: 0, dead: 0, errors: 0 };

  try {
    configureVapid();
  } catch (err) {
    console.warn("Push not configured, skipping send:", err);
    return result;
  }

  const svc = createServiceClient();
  const { data: subs } = await svc
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return result;

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint as string,
            keys: {
              p256dh: s.p256dh as string,
              auth: s.auth as string,
            },
          },
          body,
          {
            TTL: 600, // 10 minutes — if it doesn't deliver in 10, a
            // new pick is probably up and the message is stale.
            urgency: "high",
          },
        );
        result.sent += 1;

        // Touch last_used_at so we can later prune stale rows.
        await svc
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (err) {
        const statusCode =
          (err as { statusCode?: number } | undefined)?.statusCode ?? 0;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone — clean it up.
          await svc
            .from("push_subscriptions")
            .delete()
            .eq("id", s.id);
          result.dead += 1;
        } else {
          console.error("web-push send failed:", err);
          result.errors += 1;
        }
      }
    }),
  );

  return result;
}

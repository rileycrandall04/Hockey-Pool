import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Persist a Web Push subscription from the client.
 *
 * The draft room's opt-in flow calls pushManager.subscribe() in the
 * browser and POSTs the resulting subscription JSON here. We upsert
 * on (endpoint) so re-subscribing on the same device replaces the
 * previous row rather than creating duplicates.
 *
 * Body (from PushSubscription.toJSON()):
 *   {
 *     endpoint: "https://fcm.googleapis.com/...",
 *     keys: { p256dh: "...", auth: "..." }
 *   }
 *
 * Auth: signed-in user required. Non-auth hits get 401.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (
    !sub.endpoint ||
    !sub.keys?.p256dh ||
    !sub.keys?.auth
  ) {
    return NextResponse.json(
      { error: "Subscription missing endpoint or keys" },
      { status: 400 },
    );
  }

  const svc = createServiceClient();
  const { error } = await svc.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: request.headers.get("user-agent") ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

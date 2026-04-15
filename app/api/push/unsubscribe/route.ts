import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Delete a push subscription by endpoint. Called from the draft room
 * when the user taps "Disable push" (or when they revoke the site's
 * notification permission — the browser notifies JS and we forward
 * that to this route).
 *
 * Auth: signed-in user required, and the subscription row must
 * belong to them. We double-check via user_id on the delete so a
 * leaked endpoint URL can't be used to delete someone else's row.
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

  const { endpoint } = (body as { endpoint?: string }) ?? {};
  if (!endpoint) {
    return NextResponse.json(
      { error: "endpoint required" },
      { status: 400 },
    );
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

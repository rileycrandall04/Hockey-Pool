import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Tiny diagnostic endpoint that reports whether the VAPID env vars
 * are visible to the server right now. Useful when push
 * notifications aren't working and you want to rule out "env var
 * wasn't actually saved / wasn't in the build" before looking
 * anywhere else.
 *
 * We intentionally don't return the actual key values — just their
 * length, presence, and a hash prefix — so this is safe to expose
 * without auth. The public key isn't secret anyway (it ships to
 * the client), but we still want to keep the diagnostic useful
 * without leaking the private key.
 */
export async function GET() {
  const publicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  return NextResponse.json({
    public_key: publicKey
      ? {
          present: true,
          length: publicKey.length,
          // First/last few chars so the user can eyeball that it
          // matches what they pasted into Vercel.
          starts_with: publicKey.slice(0, 8),
          ends_with: publicKey.slice(-6),
          // Which env var key it came from.
          from: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
            ? "NEXT_PUBLIC_VAPID_PUBLIC_KEY"
            : "VAPID_PUBLIC_KEY",
        }
      : { present: false },
    private_key: privateKey
      ? { present: true, length: privateKey.length }
      : { present: false },
    subject: subject ?? null,
    ok: Boolean(publicKey && privateKey),
    note: "The public key ships to the client bundle. The private key stays server-side. If ok=true but the draft room still says 'VAPID public key not configured', the server has the var but the client bundle was built without it — force a rebuild with build cache disabled.",
  });
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Server action that kicks off Supabase's password-recovery email.
 *
 * We compute the redirect URL server-side using the request's
 * host header so the email's magic link points at whichever
 * environment the user started on (local dev, Vercel preview, or
 * production) without requiring an env var. The user lands on
 * /reset-password where a short client component exchanges the
 * recovery token for a fresh session and lets them pick a new
 * password.
 *
 * Whether the email exists or not we always redirect back with the
 * same "check your inbox" flash so a form submitter can't enumerate
 * valid accounts by error message.
 */
async function requestResetAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect(
      "/forgot-password?error=" +
        encodeURIComponent("Email is required"),
    );
  }

  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  // Vercel forwards the original protocol in x-forwarded-proto.
  // Fall back to https in production (any non-localhost host) and
  // http locally so dev still works without HTTPS.
  const proto =
    hdrs.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  // Route through /auth/callback so the PKCE code gets exchanged
  // for a real session BEFORE the user lands on /reset-password.
  // The `next` param tells the callback where to forward them.
  const redirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent("/reset-password")}`;

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  redirect(
    "/forgot-password?sent=" +
      encodeURIComponent(
        "If an account with that email exists, a reset link is on its way.",
      ),
  );
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-ice-300">
            Enter the email you signed up with. We&rsquo;ll send you a
            link to pick a new password.
          </p>
          <form action={requestResetAction} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
            {sent && (
              <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                ✅ {sent}
              </div>
            )}
            <Button type="submit" className="w-full">
              Send reset link
            </Button>
          </form>
          <p className="mt-4 text-sm text-ice-300">
            Remembered it?{" "}
            <Link href="/login" className="text-ice-400 hover:underline">
              Back to log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

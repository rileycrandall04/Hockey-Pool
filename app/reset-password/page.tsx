import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Final step of the password-recovery flow. By the time the user
 * reaches this page they've already been authenticated by
 * /auth/callback (which exchanged the PKCE code for a session), so
 * this is just a simple "pick a new password" form gated on the
 * session being present. A direct hit without a session bounces
 * back to /forgot-password.
 */
async function updatePasswordAction(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    redirect(
      "/reset-password?error=" +
        encodeURIComponent("Password must be at least 8 characters."),
    );
  }
  if (password !== confirm) {
    redirect(
      "/reset-password?error=" +
        encodeURIComponent("Passwords don't match."),
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      "/forgot-password?error=" +
        encodeURIComponent(
          "Your reset link expired. Request a new one below.",
        ),
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(
      "/reset-password?error=" + encodeURIComponent(error.message),
    );
  }

  redirect(
    "/dashboard?seeded=" +
      encodeURIComponent("Password updated."),
  );
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Without a session the user shouldn't be on this page — it means
  // either the reset link expired before they got here or they
  // navigated directly. Send them back to request a fresh one.
  if (!user) {
    redirect(
      "/forgot-password?error=" +
        encodeURIComponent(
          "This reset link is no longer valid. Please request a new one.",
        ),
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-ice-300">
            Signed in as <strong>{user.email}</strong>. Enter a new
            password to finish the reset.
          </p>
          <form action={updatePasswordAction} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full">
              Update password
            </Button>
          </form>
          <p className="mt-4 text-sm text-ice-300">
            Changed your mind?{" "}
            <Link href="/dashboard" className="text-ice-400 hover:underline">
              Back to dashboard
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

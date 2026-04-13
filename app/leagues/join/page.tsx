import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

async function joinLeagueAction(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const joinCode = String(formData.get("join_code") ?? "")
    .trim()
    .toUpperCase();
  const teamName = String(formData.get("team_name") ?? "").trim();
  if (!joinCode || !teamName) {
    redirect("/leagues/join?error=Missing+fields");
  }

  // The user isn't yet a member of the league, so our RLS SELECT policy
  // won't let them read it by join_code. Use the service client for the
  // lookup + team creation. We still have a verified user.id from the
  // cookie-bound client above, so the action is safe.
  const svc = createServiceClient();

  const { data: league, error: leagueError } = await svc
    .from("leagues")
    .select("id, draft_status")
    .eq("join_code", joinCode)
    .single();

  if (leagueError || !league) {
    redirect("/leagues/join?error=Invalid+join+code");
  }
  if (league.draft_status !== "pending") {
    redirect("/leagues/join?error=Draft+already+started");
  }

  // Ensure profile row.
  await svc
    .from("profiles")
    .upsert(
      { id: user.id, display_name: user.email ?? "Player", email: user.email },
      { onConflict: "id" },
    );

  const { error: insertError } = await svc.from("teams").insert({
    league_id: league.id,
    owner_id: user.id,
    name: teamName,
  });

  if (insertError) {
    redirect(
      `/leagues/join?error=${encodeURIComponent(insertError.message)}`,
    );
  }

  redirect(`/leagues/${league.id}`);
}

export default async function JoinLeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await searchParams;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-xl px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Join a league</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={joinLeagueAction} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="join_code">Join code</Label>
                <Input
                  id="join_code"
                  name="join_code"
                  required
                  placeholder="ABC234"
                  className="uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="team_name">Your team name</Label>
                <Input
                  id="team_name"
                  name="team_name"
                  required
                  placeholder="Gordie's Ghosts"
                />
              </div>
              {error && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full">
                Join league
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
